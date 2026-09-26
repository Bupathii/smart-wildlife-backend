# Backend — Wildlife Conservation API

Node.js + Express + MongoDB (Mongoose) REST API.

## Setup

```bash
cd backend
npm install
cp .env.example .env   # then edit values, especially MONGODB_URI and JWT_SECRET
npm run dev            # starts with nodemon on http://localhost:5000
```

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
