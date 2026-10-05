import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

// Same R2 client setup as app/api/nominations/submit/route.ts — kept
// deliberately identical (including the defensive .trim() on credentials)
// rather than factored into a shared helper, so this route's behavior is
// easy to audit on its own without needing to also trust a shared module.
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID?.trim()}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: (process.env.R2_ACCESS_KEY_ID ?? "").trim(),
    secretAccessKey: (process.env.R2_SECRET_ACCESS_KEY ?? "").trim(),
  },
});
const R2_BUCKET = "uninexus-nominees-media";
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB, matches the public nomination route

export async function POST(request: Request) {
  // This route lives at /admin/api/nominees/replace-photo — a path under
  // /admin, which middleware.ts already guards (redirects to /admin/login
  // if there's no session, or no matching admin_users row). The check is
  // still repeated here on purpose: an action this sensitive (replacing a
  // nominee's public photo) shouldn't depend solely on something outside
  // the route handler itself to stay safe if the route ever gets moved.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const service = createServiceRoleClient();

  const { data: admin } = await service.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!admin) {
    return NextResponse.json({ error: "Not an admin." }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const nomineeId = formData.get("nomineeId");
    const mediaId = formData.get("mediaId"); // which existing photo to replace — omitted means "add new"
    const file = formData.get("file");

    if (typeof nomineeId !== "string" || !nomineeId) {
      return NextResponse.json({ error: "Missing nomineeId." }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No photo file was received." }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Only JPEG, PNG, or WEBP images are allowed." }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Photo must be under 8MB." }, { status: 400 });
    }

    // If replacing an existing photo, look it up first — needed both to
    // preserve its sort_order and so the OLD R2 file can be deleted after
    // the new one is confirmed uploaded, instead of leaving it orphaned in
    // the bucket forever.
    let oldMediaUrl: string | null = null;
    let sortOrder = 0;
    if (typeof mediaId === "string" && mediaId) {
      const { data: existing } = await service
        .from("nominee_media")
        .select("media_url, sort_order")
        .eq("id", mediaId)
        .maybeSingle();
      if (existing) {
        oldMediaUrl = existing.media_url;
        sortOrder = existing.sort_order;
      }
    }

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${nomineeId}/${crypto.randomUUID()}.${ext}`;
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

    if (typeof mediaId === "string" && mediaId) {
      const { error: updateErr } = await service
        .from("nominee_media")
        .update({ media_url: publicUrl, media_type: "image" })
        .eq("id", mediaId);
      if (updateErr) throw updateErr;
    } else {
      const { error: insertErr } = await service
        .from("nominee_media")
        .insert({ nominee_id: nomineeId, media_url: publicUrl, media_type: "image", sort_order: sortOrder });
      if (insertErr) throw insertErr;
    }

    // Clean up the old R2 file now that the database points at the new one.
    // Not fatal if this fails — the new photo is already live and correct;
    // an orphaned old file is a minor storage-cost issue, not user-facing,
    // so it's logged rather than turned into a failed response.
    if (oldMediaUrl && process.env.R2_PUBLIC_URL && oldMediaUrl.startsWith(process.env.R2_PUBLIC_URL)) {
      const oldKey = oldMediaUrl.slice(process.env.R2_PUBLIC_URL.length + 1);
      try {
        await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey }));
      } catch (err) {
        console.error("[admin photo replace] failed to delete old R2 object:", err instanceof Error ? err.message : err);
      }
    }

    return NextResponse.json({ ok: true, mediaUrl: publicUrl });
  } catch (err: any) {
    console.error("[admin photo replace] failed:", err?.message || err);
    return NextResponse.json({ error: "Couldn't replace the photo. Please try again." }, { status: 500 });
  }
}
