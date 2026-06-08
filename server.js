import crypto from "node:crypto";
import express from "express";
import { middleware, messagingApi } from "@line/bot-sdk";

const port = Number(process.env.PORT || 10000);
const channelSecret = process.env.LINE_CHANNEL_SECRET || "";
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const shouldReply = process.env.REPLY_TO_LINE === "1";
const requests = [];

const lineConfig = {
  channelSecret: channelSecret || "dummy",
  channelAccessToken: channelAccessToken || "dummy",
};

const lineClient = channelAccessToken
  ? new messagingApi.MessagingApiClient({ channelAccessToken })
  : null;

function safeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const lower = key.toLowerCase();
      if (lower === "x-line-signature" || lower === "authorization") {
        return [key, "[REDACTED]"];
      }
      return [key, value];
    }),
  );
}

function remember(label, req, bodySummary = {}) {
  const record = {
    label,
    receivedAt: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    headers: safeHeaders(req.headers),
    bodySummary,
  };
  requests.unshift(record);
  requests.splice(50);
  console.log(JSON.stringify(record));
  return record;
}

function verifySignature(rawBody, signature) {
  if (!channelSecret || !signature) return false;
  const expected = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody, "utf8")
    .digest("base64");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function summarizeEvents(events) {
  return events.map((event) => ({
    type: event.type,
    mode: event.mode,
    webhookEventId: event.webhookEventId,
    messageType: event.message?.type,
    text: event.message?.text,
    hasReplyToken: Boolean(event.replyToken),
  }));
}

async function handleEvents(events) {
  const results = [];
  for (const event of events) {
    if (event.type !== "message" || event.message?.type !== "text") {
      results.push({ skipped: true, reason: "not_text" });
      continue;
    }

    if (!shouldReply) {
      results.push({ replySkipped: true, reason: "REPLY_TO_LINE is not 1" });
      continue;
    }

    if (!lineClient || !event.replyToken) {
      results.push({ replySkipped: true, reason: "missing_client_or_reply_token" });
      continue;
    }

    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: `SDK repro received: ${event.message.text}` }],
    });
    results.push({ replied: true });
  }
  return results;
}

function sendJson(res, status, payload) {
  res.status(status).json(payload);
}

const app = express();

app.get("/healthz", (_req, res) => {
  sendJson(res, 200, { ok: true, service: "line-sdk-render-repro" });
});

app.get("/last", (_req, res) => {
  sendJson(res, 200, { requests });
});

app.post(
  "/webhook-sdk-first",
  middleware(lineConfig),
  async (req, res) => {
    const events = req.body.events || [];
    remember("sdk-first", req, { events: summarizeEvents(events) });
    const results = await handleEvents(events);
    sendJson(res, 200, { ok: true, route: "sdk-first", results });
  },
);

app.post(
  "/webhook-raw",
  express.raw({ type: "*/*" }),
  async (req, res) => {
    const rawBody = req.body.toString("utf8");
    const signature = req.header("x-line-signature");
    const valid = verifySignature(rawBody, signature);
    let events = [];
    try {
      events = JSON.parse(rawBody).events || [];
    } catch {
      remember("raw-parse-error", req, { validSignature: valid });
      sendJson(res, 400, { ok: false, error: "invalid_json", validSignature: valid });
      return;
    }

    remember("raw", req, {
      validSignature: valid,
      rawBodySha256: sha256(rawBody),
      signatureSha256: signature ? sha256(signature) : null,
      events: summarizeEvents(events),
    });

    if (!valid) {
      sendJson(res, 401, { ok: false, error: "invalid_signature" });
      return;
    }

    const results = await handleEvents(events);
    sendJson(res, 200, { ok: true, route: "raw", results });
  },
);

app.use(express.json({ type: "*/*" }));

app.post(
  "/webhook",
  middleware(lineConfig),
  async (req, res) => {
    const events = req.body.events || [];
    remember("json-before-sdk", req, { events: summarizeEvents(events) });
    const results = await handleEvents(events);
    sendJson(res, 200, { ok: true, route: "json-before-sdk", results });
  },
);

app.use((error, req, res, _next) => {
  remember("error", req, {
    name: error?.name,
    message: error?.message,
  });
  sendJson(res, 200, {
    ok: false,
    route: req.originalUrl,
    errorName: error?.name,
    errorMessage: error?.message,
    intentionallyReturned200: true,
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`line-sdk-render-repro listening on ${port}`);
});
