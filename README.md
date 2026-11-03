# MarketHub

A full-stack, multi-vendor marketplace built with React, TypeScript, Express, and MongoDB. MarketHub combines product discovery, customer shopping, seller operations, and platform administration in a responsive forest-green and cream interface.

**[Live demo](https://market-hub-maioia1.vercel.app/)**

## Features

**Customers**

- Browse categories, search products, and filter by price, brand, rating, availability, and deals.
- Explore product galleries, specifications, related products, and customer reviews.
- Manage a cart and wishlist, check out with cash on delivery, and track or cancel eligible orders.
- Register, verify email, recover passwords, manage a profile, and receive in-app notifications.
- Review delivered purchases.

**Sellers**

- Apply to become a seller and track application status.
- Create listings, upload product images, and manage inventory.
- Monitor low-stock products and delivered merchandise sales.
- Manage seller-specific orders through confirmation, processing, shipping, and delivery.

**Administrators**

- Review seller applications and approve, reject, or suspend stores.
- Manage users, moderate listings, and maintain categories.
- Inspect orders, cancel eligible orders, and record and resolve internal disputes.
- View marketplace metrics and recorded management events.

## Tech stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, React Router |
| State and forms | Redux Toolkit, TanStack Query, Axios, React Hook Form, Zod |
| Backend | Node.js, Express 5, TypeScript, Mongoose |
| Database | MongoDB Atlas with transaction support |
| Authentication | JWT access tokens, rotating refresh cookies, bcrypt |
| Media and email | Cloudinary, Nodemailer with SMTP |
| Testing and documentation | Jest, Supertest, OpenAPI, Swagger UI, Postman |
| Deployment | Vercel configuration, optional Render API blueprint, GitHub Actions |

## Getting started

### Prerequisites

- **Node.js 22.18.0 or later in the 22.x series**, with npm.
- A MongoDB Atlas database with transaction support and network access configured.
- An SMTP service for email verification and password recovery.
- A Cloudinary account for image uploads.

### 1. Install dependencies

From the repository root:

```sh
npm ci
```

### 2. Configure the environment

Copy [`.env.example`](.env.example) to `.env`. In PowerShell:

```powershell
Copy-Item .env.example .env
```

Fill in the following settings:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Atlas connection URI; the application uses the `markethub` database |
| `JWT_ACCESS_SECRET` | Random signing secret of at least 32 characters |
| `CLIENT_ORIGIN` | Frontend origin; locally `http://localhost:5173` |
| `PORT` | API port; defaults to `4000` |
| `NODE_ENV` | `development` locally; `production` when deployed |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Email transport and sender |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Server-side image storage credentials |
| `VITE_API_URL` | Frontend API base URL; `/api` for local development and same-origin deployment |

Keep `.env` private. Database, JWT, SMTP, and Cloudinary secrets belong on the server and must never use the `VITE_` prefix. Additional maintenance flags are described in [`.env.example`](.env.example) and the [deployment guide](docs/DEPLOYMENT.md).

### 3. Check the database and create indexes

```sh
npm run check:db
```

Automatic Mongoose index creation is disabled. Explicitly provision the declared indexes against your intended database before using the application:

```powershell
$env:ALLOW_CREATE_INDEXES = 'true'
npm run db:indexes
Remove-Item Env:ALLOW_CREATE_INDEXES
```

The command creates declared indexes without dropping existing ones. The application does not fall back to a local database.

### 4. Start the application

Start the API:

```sh
npm run dev
```

In a second terminal, start the frontend:

```sh
npm run dev:client
```

| Service | Local URL |
| --- | --- |
| Storefront | [localhost:5173](http://localhost:5173) |
| API health | [localhost:4000/api/health](http://localhost:4000/api/health) |
| Swagger UI | [localhost:4000/api/docs](http://localhost:4000/api/docs) |

Vite proxies `/api` requests to Express. Register through the application and verify your email before signing in. Public registration creates customer accounts; seller access requires an approved application. Administrator accounts must be provisioned separately, and no shared administrator credentials are included.

### Optional: demonstration catalog

Seed 48 clearly marked sample products across 12 categories in a development database:

```powershell
$env:NODE_ENV = 'development'
$env:ALLOW_DEV_SEED = 'true'
npm run seed:catalog
Remove-Item Env:ALLOW_DEV_SEED
```

The seed can be rerun without duplicating demo products. It skips existing non-demo catalogs unless explicitly configured to append. It creates a demonstration seller with a random password, but no customer or administrator accounts, orders, or payments. See the [demo guide](docs/DEMO.md) and [catalog configuration](docs/REDESIGN.md).

## Available commands

| Command | Description |
| --- | --- |
| `npm run dev` | Run the API with automatic reload |
| `npm run dev:client` | Run the Vite frontend |
| `npm run build` | Compile the backend into `dist` |
| `npm run build:client` | Type-check and build the frontend into `dist-client` |
| `npm start` | Run the compiled API |
| `npm test` | Build the backend and run Jest/Supertest tests |
| `npm run check:db` | Check Atlas authentication and transaction capability |
| `npm run db:indexes` | Create database indexes with explicit opt-in |
| `npm run seed:catalog` | Add development demo products with explicit opt-in |
| `npm run docs:generate` | Regenerate API documentation artifacts |
| `npm run test:e2e` | Run live integration tests in a separately named Atlas database |
| `npm run check:smtp` | Check SMTP configuration; see the email guide for delivery testing |
| `npm run check:cloudinary` | Check the Cloudinary integration; see the media guide |

The standard test suite uses explicit Mongoose mocks and requires no Atlas credentials. Live integration checks require external services and may create test records or media; read the relevant guides first. The end-to-end test database is retained for inspection.

## Commerce and security design

- Prices use integer USD cents. Checkout calculates prices, shipping, and totals on the server and saves order-line snapshots.
- Multi-vendor orders contain separate fulfillment groups. Sellers access only their own groups.
- Checkout uses MongoDB transactions, guarded stock deductions, cart revisions, and idempotency keys. Eligible cancellations restore inventory transactionally.
- Passwords are hashed with bcrypt. Short-lived access tokens use rotating, HttpOnly refresh cookies with refresh-token replay detection.
- API routes enforce roles, resource ownership, input validation, request limits, and mutation-origin checks.
- Image uploads validate file signatures and use Cloudinary-backed media records.

### Current scope

Checkout supports **US delivery and cash on delivery only**. Shipping costs **$5 per seller**, waived when that seller's subtotal reaches **$100**. Tax calculation, online card payments, and automated refunds are not implemented. Delivered merchandise revenue measures delivered goods rather than collected cash or profit.

Production refresh cookies assume a same-site deployment. The API rate limiter uses instance-local memory; scaled deployments need a shared rate-limit store. Mocked tests cannot establish live transaction or external-service behavior; consult the verification guides below.

## Project structure

```text
MarketHub/
├── api/                 # Vercel API entry point
├── client/              # React storefront and account/seller/admin interfaces
├── server/              # Express routes, models, services, and maintenance scripts
├── tests/               # Jest/Supertest tests and fixtures
├── scripts/             # Catalog verification tools
├── docs/                # API artifacts, guides, and browser QA records
├── .github/workflows/   # Continuous integration
├── .env.example         # Environment template without credentials
├── render.yaml          # Optional Render API configuration
└── vercel.json          # Frontend and API deployment configuration
```

## Testing and deployment

Run the same core checks used by GitHub Actions:

```sh
npm test
npm run build:client
```

Vercel configuration builds the frontend and API, routes `/api/*` to Express, and serves React Router pages through the SPA fallback. The Render blueprint provides an alternative API host. Configure secrets, provision database indexes, and complete service checks for each target environment using the [deployment runbook](docs/DEPLOYMENT.md).

## Documentation

- [API specification](docs/openapi.json) and [Postman collection](docs/MarketHub.postman_collection.json)
- [Authentication and session behavior](docs/AUTHENTICATION.md)
- [Testing and live integration checks](docs/TESTING.md)
- [Browser QA and screenshots](docs/BROWSER_QA.md)
- [SMTP setup and email verification](docs/SMTP.md)
- [Cloudinary setup and media lifecycle](docs/CLOUDINARY.md)
- [Storefront design and catalog configuration](docs/REDESIGN.md)
- [Deployment and release checks](docs/DEPLOYMENT.md)
