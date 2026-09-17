import { NextResponse } from "next/server";
import { z } from "zod";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { nominationSubmitLimiter, enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { enforceCors } from "@/lib/cors";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { sendNewNominationAlertEmail } from "@/lib/resend";
import * as Sentry from "@sentry/nextjs";

// R2 is S3-compatible, so the standard AWS SDK talks to it directly —
// just pointed at Cloudflare's endpoint instead of AWS's. Values are trimmed
// defensively: a stray space or newline from a mobile copy-paste (the exact
// bug that broke the Upstash token earlier) would otherwise produce a
// malformed endpoint or a silently-rejected signature.
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID?.trim()}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: (process.env.R2_ACCESS_KEY_ID ?? "").trim(),
    secretAccessKey: (process.env.R2_SECRET_ACCESS_KEY ?? "").trim(),
  },
});
const R2_BUCKET = "nominee-media";

const MAX_MEDIA_ITEMS = 2;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const fieldsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  categoryId: z.string().uuid(),
  about: z.string().trim().min(10).max(600),
  submitterEmail: z.string().trim().email("Please enter a valid email address."),
  submitterPhone: z.string().trim().min(7, "Please enter a valid phone number.").max(20),
  website: z.string().optional().or(z.literal("")),
});

// A short-lived cache of category status, shared across requests handled by
// the same warm serverless instance. Categories change rarely (an admin
// toggles nominations_open a handful of times, not constantly), but this
// endpoint is hit on EVERY single submission — during a burst of nominations
// (e.g. right after a category link gets shared widely), that's a lot of
// identical "is this category still open" reads hitting Supabase for
// information that was almost certainly still true 20 seconds ago. Caching it
// briefly cuts real database load under exactly the burst conditions this was
// asked to handle better, without ever letting a stale "open" status persist
// for more than a few seconds after an admin actually closes a category.
const CATEGORY_CACHE_TTL_MS = 20_000;
const categoryCache = new Map<string, { data: { id: string; name: string; nominations_open: boolean }; expiresAt: number }>();

async function getCategoryCached(supabase: ReturnType<typeof createServiceRoleClient>, categoryId: string) {
  const cached = categoryCache.get(categoryId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const { data } = await supabase.from("categories").select("id, name, nominations_open").eq("id", categoryId).maybeSingle();
  if (data) categoryCache.set(categoryId, { data, expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS });
  return data;
}

export async function POST(request: Request) {
  const corsBlock = enforceCors(request);
  if (corsBlock) return corsBlock;

  const blocked = await enforceRateLimit(nominationSubmitLimiter, `nominate:${clientIp(request)}`);
  if (blocked) return blocked;

  try {
    const formData = await request.formData();

    const parsed = fieldsSchema.safeParse({
      name: formData.get("name"),
      categoryId: formData.get("categoryId"),
      about: formData.get("about"),
      submitterEmail: formData.get("submitterEmail") || "",
      submitterPhone: formData.get("submitterPhone") || "",
      website: formData.get("website") || "",
    });

    if (!parsed.success) {
      return NextResponse.json({ error: "Please check the form — some fields need fixing." }, { status: 400 });
    }

    const { name, categoryId, about, submitterEmail, submitterPhone, website } = parsed.data;

    if (website) {
      return NextResponse.json({ ok: true });
    }

    const ip = clientIp(request);
    const turnstileToken = formData.get("turnstileToken");
    const turnstileOk = await verifyTurnstileToken(typeof turnstileToken === "string" ? turnstileToken : null, ip);
    if (!turnstileOk) {
      return NextResponse.json({ error: "Verification failed — please try again." }, { status: 400 });
    }

    const files = formData.getAll("media").filter((f): f is File => f instanceof File && f.size > 0);

    if (files.length > MAX_MEDIA_ITEMS) {
      return NextResponse.json({ error: `Please upload at most ${MAX_MEDIA_ITEMS} photos.` }, { status: 400 });
    }

    for (const file of files) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return NextResponse.json(
          { error: `"${file.name}" isn't a supported photo format. Please upload a JPEG, PNG, or WEBP photo or logo.` },
          { status: 400 }
        );
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: `"${file.name}" is too large — please keep photos under 8MB.` }, { status: 400 });
      }
    }

    const supabase = createServiceRoleClient();

    const category = await getCategoryCached(supabase, categoryId);
    if (!category || !category.nominations_open) {
      return NextResponse.json({ error: "Nominations aren't open for this category right now." }, { status: 400 });
    }

    const { data: nominee, error: insertErr } = await supabase
      .from("nominees")
      .insert({
        category_id: categoryId,
        name,
        about,
        submitter_email: submitterEmail,
        submitter_phone: submitterPhone,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertErr?.code === "23505") {
      return NextResponse.json(
        { error: "This nomination looks like a duplicate — it's already been submitted." },
        { status: 409 }
      );
    }

    if (insertErr || !nominee) {
      // Logged with the full Supabase error (code + message + hint) rather than
      // just re-thrown generically — this is exactly the detail that tells you
      // whether it's a missing table, an RLS denial, or something else, instead
      // of every failure looking identical from the outside.
      console.error("[nominations] insert failed:", JSON.stringify(insertErr));
      Sentry.captureException(new Error(`Nominee insert failed: ${insertErr?.message || "no row returned"}`), {
        extra: { categoryId, supabaseError: insertErr },
      });
      throw insertErr || new Error("Failed to save nomination.");
    }

    // Media uploads run in parallel rather than one-at-a-time — with the
    // maximum of 2 items, a sequential loop meant a nomination with two
    // photos could take twice as long to finish than one with just text,
    // for no real reason: each file's upload+DB-row insert is fully
    // independent of the others.
    if (files.length > 0) {
      const results = await Promise.allSettled(
        files.map(async (file, index) => {
          const ext = file.name.split(".").pop() || "jpg";
          const path = `${nominee.id}/${crypto.randomUUID()}.${ext}`;
          const bytes = new Uint8Array(await file.arrayBuffer());

          await r2.send(
            new PutObjectCommand({
              Bucket: R2_BUCKET,
              Key: path,
              Body: bytes,
              ContentType: file.type,
            })
          );

          const publicUrl = `${process.env.R2_PUBLIC_URL}/${path}`;
          const { error: mediaInsertErr } = await supabase.from("nominee_media").insert({
            nominee_id: nominee.id,
            media_url: publicUrl,
            media_type: "image",
            sort_order: index,
          });
          if (mediaInsertErr) throw mediaInsertErr;
        })
      );

      // One bad file shouldn't cost the whole nomination (already-verified text
      // is saved regardless) — but each failure is now logged to console AND
      // Sentry. Console-only visibility matters here specifically: it's what
      // shows up in Vercel's runtime logs, which is how this exact kind of
      // silent failure gets diagnosed without needing the Sentry dashboard.
      results.forEach((r) => {
        if (r.status === "rejected") {
          console.error("[nominations] media upload failed:", r.reason instanceof Error ? r.reason.message : r.reason);
          Sentry.captureException(r.reason);
        }
      });
    }

    try {
      await sendNewNominationAlertEmail({ nomineeName: name, categoryName: category.name });
    } catch (emailErr) {
      Sentry.captureException(emailErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    Sentry.captureException(err);
    console.error("[nominations] submit failed:", err?.message || err);
    return NextResponse.json({ error: "Couldn't submit your nomination. Please try again." }, { status: 500 });
  }
}
