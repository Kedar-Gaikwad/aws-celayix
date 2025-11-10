import express from "express";
import client from "prom-client";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

const sns = new SNSClient({ region: AWS_REGION });

// Metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const visitCounter = new client.Counter({
  name: "demo_visits_total",
  help: "Total number of visits (button clicks)."
});
register.registerMetric(visitCounter);

const replicasGauge = new client.Gauge({
  name: "demo_replicas",
  help: "Number of app replicas (simulated)."
});
register.registerMetric(replicasGauge);

const deviceCounter = new client.Counter({
  name: "demo_device_requests_total",
  help: "Requests grouped by detected device type.",
  labelNames: ["device"]
});
register.registerMetric(deviceCounter);

const detectDevice = (userAgent = "") => {
  const ua = userAgent.toLowerCase();
  if (ua.includes("iphone")) return "iphone";
  if (ua.includes("ipad")) return "ipad";
  if (ua.includes("android")) return "android";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os") || ua.includes("macintosh")) return "mac";
  if (ua.includes("linux")) return "linux";
  return "other";
};

app.use((req, _res, next) => {
  if (req.path === "/metrics") {
    return next();
  }
  const userAgent = req.get("user-agent") || "";
  const device = detectDevice(userAgent);
  deviceCounter.labels(device).inc();
  next();
});

let replicas = 1; // simulated replicas 1..3
let visits = 0;

// Simple web UI
const page = (visits, replicas) => `
<!doctype html>
<html>
<head><title>SRE Demo</title></head>
<body style="font-family: sans-serif; max-width: 720px; margin: 40px auto;">
  <h1>SRE/DevOps Demo</h1>
  <p>Visits: <b>${visits}</b></p>
  <p>Replicas (simulated): <b>${replicas}</b></p>

  <form method="POST" action="/visit" style="display:inline;">
    <button type="submit">Visit (+1)</button>
  </form>

  <form method="POST" action="/scale" style="display:inline;margin-left:12px;">
    <button type="submit">Scale → add replica (max 3)</button>
  </form>

  <p style="margin-top:16px;">Metrics: <a href="/metrics">/metrics</a> | Health: <a href="/healthz">/healthz</a></p>
</body>
</html>
`;

app.get("/", (_req, res) => { res.send(page(visits, replicas)); });

app.post("/visit", async (_req, res) => {
  visits += 1;
  visitCounter.inc();

  if (visits === 10 && SNS_TOPIC_ARN) {
    try {
      await sns.send(new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: "SRE Demo ALERT: Visits hit 10",
        Message: `The visit counter reached 10. System under load (demo).`
      }));
      console.log("SNS alert published");
    } catch (e) {
      console.error("SNS publish failed", e);
    }
  }
  res.redirect("/");
});

app.post("/scale", (_req, res) => {
  replicas = Math.min(replicas + 1, 3);
  replicasGauge.set(replicas);
  res.redirect("/");
});

app.get("/healthz", (_req, res) => res.send("ok"));

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  replicasGauge.set(replicas);
  console.log(`App on :${PORT}`);
});
