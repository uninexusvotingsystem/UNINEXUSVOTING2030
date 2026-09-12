import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { nominationSubmitLimiter, enforceRateLimit, clientIp } from "@/lib/rate-limit";
import { enforceCors } from "@/lib/cors";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { sendNewNominationAlertEmail } from "@/lib/resend";
import * as Sentry from "@sentry/nextjs";

const MAX_MEDIA_ITEMS = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
// A hard duration check needs video-processing tooling this environment doesn't
// have; capping file size is the practical proxy for "keep it to ~20 seconds" —
// a properly compressed 20s clip comfortably fits well under this.
const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // 25MB

const fieldsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  categoryId: z.string().uuid(),
  about: z.string().trim().min(10).max(600),
  submitterEmail: z.string().trim().email().optional().or(z.literal("")),
  submitterPhone: z.string().trim().max(20).optional().or(z.literal("")),
  // Honeypot: a hidden field real visitors never see or fill in, but a scripted
  // bot filling every input on the page typically does. Silently accepting
  // (not rejecting) a filled honeypot avoids teaching a bot which field gave it
  // away, while never actually storing anything it submitted.
  website: z.string().optional().or(z.literal("")),
});

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

    // Honeypot tripped — pretend success, save nothing.
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
      return NextResponse.json({ error: `Please upload at most ${MAX_MEDIA_ITEMS} media items.` }, { status: 400 });
    }

    const videoFiles = files.filter((f) => f.type.startsWith("video/"));
    if (videoFiles.length > 1) {
      return NextResponse.json({ error: "Only one video is allowed per nomination." }, { status: 400 });
    }

    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      if (!isImage && !isVideo) {
        return NextResponse.json({ error: `"${file.name}" isn't an image or video file.` }, { status: 400 });
      }
      if (isImage && file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: `"${file.name}" is too large — please keep photos under 8MB.` }, { status: 400 });
      }
      if (isVideo && file.size > MAX_VIDEO_BYTES) {
        return NextResponse.json({ error: `"${file.name}" is too large for a ~20 second clip — please compress it.` }, { status: 400 });
      }
    }

    const supabase = createServiceRoleClient();

    const { data: category } = await supabase.from("categories").select("id, name, nominations_open").eq("id", categoryId).maybeSingle();
    if (!category || !category.nominations_open) {
      return NextResponse.json({ error: "Nominations aren't open for this category right now." }, { status: 400 });
    }

    // The nominee row is created as 'pending' no matter what — nothing from this
    // endpoint is ever visible to the public until an admin approves it.
    const { data: nominee, error: insertErr } = await supabase
      .from("nominees")
      .insert({
        category_id: categoryId,
        name,
        about,
        submitter_email: submitterEmail || null,
        submitter_phone: submitterPhone || null,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertErr || !nominee) throw insertErr || new Error("Failed to save nomination.");

    let sortOrder = 0;
    for (const file of files) {
      const isVideo = file.type.startsWith("video/");
      const ext = file.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
      const path = `${nominee.id}/${crypto.randomUUID()}.${ext}`;
      const bytes = new Uint8Array(await file.arrayBuffer());

      const { error: uploadErr } = await supabase.storage.from("nominee-media").upload(path, bytes, { contentType: file.type });
      if (uploadErr) {
        Sentry.captureException(uploadErr);
        continue; // Don't fail the whole nomination over one bad file upload.
      }

      const { data: pub } = supabase.storage.from("nominee-media").getPublicUrl(path);
      await supabase.from("nominee_media").insert({
        nominee_id: nominee.id,
        media_url: pub.publicUrl,
        media_type: isVideo ? "video" : "image",
        sort_order: sortOrder++,
      });
    }

    // Best-effort notification — a failed email should never make the nomination
    // itself fail, since it's already safely saved either way.
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
