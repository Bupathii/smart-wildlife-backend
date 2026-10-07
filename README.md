# Backend — Wildlife Conservation API

Node.js + Express + MongoDB (Mongoose) REST API.

## Setup

```bash
cd backend
npm install
cp .env.example .env   # then edit values, especially MONGODB_URI and JWT_SECRET
npm run dev            # starts with nodemon on http://localhost:5000
```

Before starting the backend, copy `.env.example` to `.env` and set `MONGODB_URI` and `JWT_SECRET`. Uploads are stored locally under `uploads/` by default, so Cloudinary credentials are not required.

To use Cloudinary instead, create or sign in to a Cloudinary account and copy the cloud name, API key, and API secret from the Cloudinary console's API Keys section into `.env`:

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

Keep `.env` private; it is ignored by Git. Restart the backend after changing these values. Local uploads are served from `/uploads` by the backend.

Health check: `GET http://localhost:5000/api/health`

## Structure

```
src/
  config/       # DB connection, other config
  controllers/  # Request handlers
  middleware/   # Auth, error handling, etc.
  models/       # Mongoose schemas
  routes/       # Express routers
  services/     # Business logic helpers
  app.js        # Express app setup
  server.js     # Entry point
```

Modules (auth, patrols, incidents, animals, alerts, reports) will be added incrementally in later phases.
