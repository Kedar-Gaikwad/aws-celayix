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
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SRE Demo Dashboard</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0f2027, #203a43, #2c5364);
      color: #0f172a;
    }
    .card {
      background: #f8fafc;
      border-radius: 18px;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.25);
      width: min(90vw, 640px);
      padding: 40px;
      box-sizing: border-box;
    }
    h1 {
      margin: 0 0 8px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: #0f172a;
    }
    p.description {
      margin: 0 0 24px;
      color: #475569;
      font-size: 0.98rem;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .stat {
      background: white;
      border-radius: 12px;
      padding: 16px 18px;
      box-shadow: inset 0 1px 0 rgba(148, 163, 184, 0.1);
    }
    .stat-label {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748b;
    }
    .stat-value {
      margin-top: 8px;
      font-size: 1.9rem;
      font-weight: 600;
      color: #0f172a;
    }
    .actions {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    button {
      background: linear-gradient(135deg, #2563eb, #4f46e5);
      border: none;
      border-radius: 999px;
      padding: 12px 22px;
      font-size: 0.95rem;
      font-weight: 600;
      color: white;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      box-shadow: 0 10px 30px rgba(59, 130, 246, 0.35);
    }
    button.reset {
      background: linear-gradient(135deg, #ef4444, #f97316);
      box-shadow: 0 10px 30px rgba(239, 68, 68, 0.35);
    }
    button.reset:hover {
      box-shadow: 0 14px 36px rgba(249, 115, 22, 0.35);
    }
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 36px rgba(79, 70, 229, 0.35);
    }
    button:active {
      transform: translateY(0);
    }
    .links {
      margin-top: 32px;
      font-size: 0.9rem;
      color: #475569;
    }
    .links a {
      color: #2563eb;
      text-decoration: none;
      font-weight: 500;
    }
    .links a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>SRE / DevOps Demo</h1>
    <p class="description">Monitor visitor traffic, experiment with replica scaling, and explore instrumentation data exported to Prometheus.</p>
    <section class="stats">
      <article class="stat">
        <div class="stat-label">Total Visits</div>
        <div class="stat-value">${visits}</div>
      </article>
      <article class="stat">
        <div class="stat-label">Active Replicas</div>
        <div class="stat-value">${replicas}</div>
      </article>
    </section>
    <section class="actions">
      <form method="POST" action="/visit">
        <button type="submit">Record Visit</button>
      </form>
      <form method="POST" action="/scale">
        <button type="submit">Scale Up Replica</button>
      </form>
      <form method="POST" action="/reset">
        <button type="submit" class="reset">Reset Counters</button>
      </form>
    </section>
    <p class="links">Metrics: <a href="/metrics">/metrics</a> &nbsp;•&nbsp; Health: <a href="/healthz">/healthz</a></p>
  </main>
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

app.post("/reset", (_req, res) => {
  visits = 0;
  visitCounter.reset();
  deviceCounter.reset();
  replicas = 1;
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
