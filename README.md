
---

## Backend repo


# ContestHub Server (API)

This repository contains the **backend API** for ContestHub – a role-based contest creation and participation platform.  
It provides REST endpoints for authentication (via JWT), contests, submissions, users, roles, payments, and leaderboard data.

---

## Live API

- **Base URL**: https://contest-client-11.vercel.app

Example endpoints:

- `GET /` → health check (`ContestHub Server is running`)  
- `GET /contests` → list approved contests (with pagination)  
- `GET /leaderboard` → leaderboard by number of wins

---

## Features

- **JWT-based authentication layer**
  - `/jwt` endpoint signs JWT tokens based on authenticated Firebase user email.
  - `verifyToken` middleware protects all private, update, and delete endpoints.
  - `verifyAdmin` middleware restricts admin routes to `role: "admin"` users.

- **User management**
  - `POST /users` – create user document (from frontend register/Google login).
  - `GET /users/role/:email` – return role for a given email (default to `user`).
  - `GET /users` – admin only, list all users.
  - `PATCH /users/:id/role` – admin only, change role (User ↔ Creator ↔ Admin).
  - `GET /users/me` – get current user profile.
  - `PATCH /users/profile` – update name, photoURL, and bio for current user.
  - `GET /users/stats` – return `participated` and `wins` counts for current user.
  - `GET /users/wins` – return all contests where current user is the winner.

- **Contest management**
  - `GET /contests` – public, returns all approved contests with search, type filter, and pagination.
  - `GET /contests/popular` – top contests sorted by participation count.
  - `GET /contests/:id` – get a single contest by id.
  - `POST /contests` – creator only, create contest (starts as `pending`).
  - `GET /creator/contests` – creator only, list contests created by current user.
  - `DELETE /creator/contests/:id` – creator only, delete if `status: "pending"`.
  - `PATCH /creator/contests/:id` – creator only, edit own pending contest.
  - `GET /creator/contests/:id/submissions` – creator only, list submissions for their contest.
  - `PATCH /creator/submissions/:id/winner` – creator only, declare a single winner (one per contest).

- **Admin contest controls**
  - `GET /admin/contests` – admin only, list all contests with pagination and optional status filter.
  - `PATCH /admin/contests/:id/status` – admin only, set status to `approved` or `rejected`.
  - `DELETE /admin/contests/:id` – admin only, delete contest.

- **Submissions**
  - `POST /contests/:id/submissions` – logged-in, registered user can submit task content.
  - Submissions stored in a `submissions` collection, linked to contest and user.

- **Payments**
  - Stripe (test mode) integration using Payment Intents.
  - `POST /payments/create-intent` – create PaymentIntent for a contest’s entry fee (JWT-protected).
  - `POST /payments` – save payment info after Stripe confirms payment; increments contest `participationCount`.
  - `GET /payments/my` – list all payments (registrations) for current user (used in “My Participated Contests”).
  - `GET /payments/registered/:contestId` – returns `{ registered: true/false }` for current user.

- **Leaderboard**
  - `GET /leaderboard` – aggregate contests by `winnerUserEmail`, join with users collection, and return ranked list with wins and total prize money.

- **Security & Middleware**
  - CORS configured for local dev and deployed frontend origin.
  - All sensitive credentials (`DB_USER`, `DB_PASS`, `ACCESS_TOKEN_SECRET`, `STRIPE_SECRET_KEY`) loaded from `.env`.

---

## Tech Stack

- **Runtime:** Node.js  
- **Framework:** Express  
- **Database:** MongoDB (Atlas)  
- **Auth:** JWT (`jsonwebtoken`)  
- **Payments:** Stripe (Payment Intents, test mode)  
- **Other:** dotenv, cors, MongoDB Node driver

---