# GoNoGo: know before you go

**Flood go/no-go alerts for Delhi's underpasses, before you drive into one.**

Built for *Environmental Hacks* (Bharat Builds Tour, WeMakeDevs × AWS), Heat & Water track.

**Live demo:** https://gonogo-tau.vercel.app (storm replay works now; live alerts once the AWS backend is connected)

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
- **Citizen photo reports:** Claude on Amazon Bedrock estimates water depth against a car tyre, kerb or person, and the spot updates immediately.
- **Storm replay** of real Delhi storms (28 Jun 2024, 31 Jul 2024, 19 Jul 2020), checked against flooding the news reported.

## Built on AWS

| Service | Role |
|---|---|
| AWS Lambda | API and the risk engine (Python 3.12) |
| Amazon API Gateway (HTTP API) | Public API for the web app and the Telegram webhook |
| Amazon EventBridge Scheduler | Runs the risk engine every 15 minutes |
| Amazon DynamoDB | Live status, subscribers, photo reports |
| Amazon S3 | Citizen photos (private, 30-day expiry) |
| Amazon Bedrock (Claude) | Water-depth estimate from photos |
| AWS SAM | Infrastructure as code ([`backend/template.yaml`](backend/template.yaml)) |

```
EventBridge (15 min) ─► Lambda risk engine ─► Open-Meteo rainfall
                              │
                              ├─► DynamoDB (status)
                              └─► Telegram alerts on worsening
Web app ─► API Gateway ─► Lambda API ─► DynamoDB · S3 · Bedrock (photo depth)
```

## Run locally

```bash
cd backend && pip install -r src/requirements.txt pytest && python -m pytest tests
python backend/local_server.py          # API on :8787, in-memory store
cd frontend && npm install && npm run dev
```

## Deploy

```bash
cd backend && sam build && sam deploy --guided --region ap-south-1
```

## Data and honesty notes

- Spot coordinates are approximate; the list comes from Delhi PWD / traffic police hotspot reporting.
- Gridded forecast data badly undercounts Delhi cloudbursts: for 28 Jun 2024, Open-Meteo shows ~24 mm against IMD's observed 228 mm. Replays therefore use IMD's observed totals, with hourly shapes reconstructed from IMD press releases; see `backend/src/gonogo/data/storms.json`. Live mode uses forecasts, which is why the citizen photo layer exists.

## Credits

Rainfall: [Open-Meteo](https://open-meteo.com) and India Meteorological Department. Map: © OpenStreetMap contributors. Built with Claude Code as an AI coding assistant.
