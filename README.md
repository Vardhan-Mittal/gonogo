# GoNoGo: know before you go

**Flood go/no-go alerts for Delhi's underpasses, before you drive into one.**

Built for *Environmental Hacks* (Bharat Builds Tour, WeMakeDevs × AWS), Heat & Water track.

**Live demo:** https://gonogo-tau.vercel.app (backend on AWS Lambda in ap-southeast-2)

## The problem

Every monsoon, people in Delhi-NCR drown in places they drive through every day:

| Date | Where | What happened |
|---|---|---|
| 19 Jul 2020 | Minto Bridge underpass, Delhi | Tempo driver drowned driving through the flooded underpass ([Scroll](https://scroll.in/latest/967932/delhi-one-die-as-heavy-rain-hits-capital-traffic-jams-power-outages-in-several-places)) |
| 27 Jul 2024 | Old Rajinder Nagar, Delhi | Three UPSC aspirants drowned in a flooded coaching-centre basement ([Business Standard](https://business-standard.com/india-news/2-students-drown-in-flooded-delhi-coaching-centre-basement-after-heavy-rain-124072700966_1.html)) |
| 31 Jul 2024 | Ghazipur, Delhi | A mother and her 3-year-old son drowned in a waterlogged drain ([National Herald](https://www.nationalheraldindia.com/national/heavy-rain-brings-delhi-to-its-knees-2-drown-in-ghazipur-schools-closed)) |
| 13 Sep 2024 | Old Faridabad railway underpass | Two bank employees moved a barricade and drove in; both drowned ([Tribune](https://www.tribuneindia.com/news/haryana/faridabad-drowning-suv-driver-ignored-warning-barricades-claim-cops)) |

Delhi has **410 waterlogging points** (traffic police, 2025). Today's warnings are traffic-police posts made *after* a spot floods, or a barricade *at* the spot, which Faridabad showed is too late. People need the warning before they leave.

## What GoNoGo does

- **Safe / Risky / Do not enter** for 19 known Delhi flood spots, updated every 15 minutes from rainfall in the last hour, the last 3 hours and the next hour.
- Levels follow **Delhi PWD's own underpass procedure**: start pumps at 6–8 inches of water, stop traffic above 8 inches.
- **Telegram alerts in Hindi or English** for the spots on your daily route, sent when a spot gets worse.
- **Citizen photo reports:** Amazon Nova Pro on Amazon Bedrock estimates water depth against a car tyre, kerb or person, and the spot updates immediately.
- **Storm replay** of real Delhi storms (28 Jun 2024, 31 Jul 2024, 19 Jul 2020), checked against flooding the news reported.

## Built on AWS

| Service | Role |
|---|---|
| AWS Lambda | API, the risk engine, and an async photo-report worker (Python 3.12) |
| Amazon API Gateway (HTTP API) | Public API for the web app and the Telegram webhook |
| Amazon EventBridge Scheduler | Runs the risk engine every 15 minutes |
| Amazon DynamoDB | Live status, subscribers, photo reports |
| Amazon S3 | Citizen photos (private, 30-day expiry) |
| Amazon Bedrock (Amazon Nova Pro) | Water-depth estimate from photos (a Claude path via the Anthropic SDK is built in for accounts with Anthropic models enabled) |
| AWS SAM | Infrastructure as code ([`backend/template.yaml`](backend/template.yaml)) |

```
EventBridge (15 min) ─► Lambda risk engine ─► Open-Meteo rainfall
                              │
                              ├─► DynamoDB (status)
                              └─► Telegram alerts on worsening
Web app ─► API Gateway ─► Lambda API ─► DynamoDB · S3
                                 └─(async)─► Lambda worker ─► Bedrock / Nova Pro (photo depth) ─► alerts
```

## Run locally

```bash
cd backend && pip install -r src/requirements.txt pytest && python -m pytest tests
python backend/local_server.py          # API on :8787, in-memory store
cd frontend && npm install && npm run dev
```

## Deploy

```bash
cd backend
sam build
sam deploy --stack-name gonogo --region ap-southeast-2 --resolve-s3 --capabilities CAPABILITY_IAM
python scripts/connect_telegram.py     # asks for the bot token, redeploys with it, registers the webhook
```

Then set `VITE_API_URL` to the stack's `ApiUrl` output where the frontend is hosted and rebuild. Without it, the site runs on bundled replay data (`backend/export_static.py`).

## Does it work? Replaying real storms

Each storm is replayed hour by hour. Every spot's rain is scaled from the storm's IMD station totals (inverse-distance weighting), and the model runs twice: with a 1-hour rain forecast (the next hour's observed rain stands in for a good nowcast) and with **rain gauges only**.

| Storm | Spots reported flooded in the news | Flagged "Do not enter" (with forecast) | Flagged (gauges only) |
|---|---|---|---|
| 28 Jun 2024 | Pragati Maidan tunnel, Minto Bridge, ITO, Dhaula Kuan, Azad Market | 5 of 5: four of them 1–2 h before the heaviest hour; ITO 1 h after | 5 of 5 |
| 31 Jul 2024 | Ghazipur, Pragati Maidan (Bharat Mandapam) | 2 of 2, 1 h before the heaviest hour | 2 of 2, at the heaviest hour |
| 19 Jul 2020 | Minto Bridge (driver drowned) | 1 of 1, 2 h before the heaviest hour | 1 of 1, 1 h before |

What this does **not** show: news reports don't give the minute each spot flooded, so lead time is measured against the hour of heaviest rain, and spots the news didn't mention can't be scored as false alarms.

## Limits we know about

- **Thresholds are a starting point, not calibrated.** Spots flip at 20–40 mm/h (lower for underpasses and spots that flood every year), mapped onto Delhi PWD's 6-inch / 8-inch underpass procedure. The replays are how they get tuned; drainage capacity per spot isn't public.
- **Forecasts miss cloudbursts.** For 28 Jun 2024, Open-Meteo shows ~24 mm where IMD observed 228 mm. Replays use IMD observations (hourly shapes reconstructed from IMD press releases; see `backend/src/gonogo/data/storms.json`). Live mode uses forecasts, which is exactly why the citizen photo layer exists.
- **Photo depth is an estimate.** The model is told to round up when unsure, and a photo report expires after an hour.
- **Coordinates** were checked against OpenStreetMap; most are within 0.5 km, a few within 1 km.

## Credits

Rainfall: [Open-Meteo](https://open-meteo.com) and India Meteorological Department. Map: © OpenStreetMap contributors. Built with Claude Code as an AI coding assistant.
