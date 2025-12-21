const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);


const app = express();
const port = process.env.PORT || 5000;

// --------- Middleware ----------
app.use(
    cors({
        origin: ["http://localhost:5173", "https://contest-client-11.vercel.app"],
        credentials: true,
    })
);
app.use(express.json());

// --------- MongoDB Connection ----------
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nseft0p.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

// --------- JWT Route ----------
app.post("/jwt", async (req, res) => {
    const user = req.body; // { email }
    if (!user?.email) {
        return res.status(400).send({ message: "Email is required" });
    }

    try {
        const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
            expiresIn: "7d",
        });
        res.send({ token });
    } catch (error) {
        console.error("JWT sign error:", error);
        res.status(500).send({ message: "Failed to generate token" });
    }
});

// ---------- Verify Token Middleware (global) ----------
const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: "Unauthorized access" });
    }

    const token = authHeader.split(" ")[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            console.error("JWT verify error:", err);
            return res.status(403).send({ message: "Forbidden access" });
        }
        req.decoded = decoded; // { email, iat, exp }
        next();
    });
};
// ---------- Verify Admin Middleware ----------
const verifyAdmin = async (req, res, next) => {
    const email = req.decoded.email;
    const user = await userCollection.findOne({ email });
    if (user?.role !== "admin") {
        return res
            .status(403)
            .send({ message: "Forbidden: admin access only" });
    }
    next();
};


let userCollection, contestCollection, submissionCollection, paymentCollection;

// Modified MongoDB Connection
async function connectDB() {
    try {
        const db = client.db("contestHubDB");
        userCollection = db.collection("users");
        contestCollection = db.collection("contests");
        submissionCollection = db.collection("submissions");
        paymentCollection = db.collection("payments");
        console.log("Connected to MongoDB");
    } catch (error) {
        console.error("DB Connection Error:", error);
    }
}
connectDB();

// async function run() {
//     try {
//         await client.connect();
//         const db = client.db("contestHubDB");
//         const userCollection = db.collection("users");
//         const contestCollection = db.collection("contests");
//         const submissionCollection = db.collection("submissions");
//         const paymentCollection = db.collection("payments");






//         // --------- MongoDB Ping ----------
//         // await client.db("admin").command({ ping: 1 });
//         // console.log("Successfully connected to MongoDB!");
//     } finally {
//     }
// }
// run().catch(console.dir);

// ---------- USER ROUTES ----------

// Create user (register/Google signup)
app.post("/users", async (req, res) => {
    const user = req.body; // { name, email, photoURL, role, rolePreference? }

    if (!user?.email) {
        return res.status(400).send({ message: "Email is required" });
    }

    try {
        const existing = await userCollection.findOne({ email: user.email });
        if (existing) {
            return res.send({
                message: "User already exists",
                insertedId: null,
            });
        }

        if (!user.role) {
            user.role = "user";
        }

        const result = await userCollection.insertOne(user);
        res.send(result);
    } catch (error) {
        console.error("Error inserting user:", error);
        res.status(500).send({ message: "Failed to save user" });
    }
});

// Get role of a user by email (public)
app.get("/users/role/:email", async (req, res) => {
    const email = req.params.email;
    const user = await userCollection.findOne({ email });
    const role = user?.role || "user";
    res.send({ role });
});

// Get all users (admin only)
app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const users = await userCollection.find().toArray();
        res.send(users);
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ message: "Failed to fetch users" });
    }
});

// Change user role (admin only)
app.patch("/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const { role } = req.body;
        const validRoles = ["user", "creator", "admin"];

        if (!validRoles.includes(role)) {
            return res.status(400).send({ message: "Invalid role" });
        }

        const filter = { _id: new ObjectId(id) };
        const updateDoc = { $set: { role } };

        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result);
    } catch (error) {
        console.error("Error updating role:", error);
        res.status(500).send({ message: "Failed to update user role" });
    }
});

// ---------- CONTEST ROUTES ----------

// Public: Get contests 
app.get("/contests", async (req, res) => {
    try {
        const search = req.query.search || "";
        const type = req.query.type;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 9; // items per page
        const skip = (page - 1) * limit;

        const query = {
            name: { $regex: search, $options: "i" },
            status: "approved",
        };

        if (type) {
            query.type = type;
        }

        const total = await contestCollection.countDocuments(query);

        const contests = await contestCollection
            .find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        res.send({
            contests,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error("Error fetching contests:", error);
        res.status(500).send({ message: "Failed to fetch contests" });
    }
});

// Public: popular contests
app.get("/contests/popular", async (req, res) => {
    try {
        const result = await contestCollection
            .find({ status: "approved" })
            .sort({ participationCount: -1 })
            .limit(6)
            .toArray();
        res.send(result);
    } catch (error) {
        console.error("Error fetching popular contests:", error);
        res.status(500).send({ message: "Failed to fetch popular contests" });
    }
});

// Leaderboard: users ranked by number of wins
app.get("/leaderboard", async (req, res) => {
    try {
        // Group contests by winner email
        const pipeline = [
            {
                $match: {
                    winnerUserEmail: { $exists: true, $ne: null },
                },
            },
            {
                $group: {
                    _id: "$winnerUserEmail",
                    wins: { $sum: 1 },
                    totalPrize: { $sum: { $ifNull: ["$prizeMoney", 0] } },
                },
            },
            {
                $sort: { wins: -1, totalPrize: -1 },
            },
            {
                $limit: 5,
            },
            {
                $lookup: {
                    from: "users",
                    localField: "_id",
                    foreignField: "email",
                    as: "user",
                },
            },
            {
                $unwind: {
                    path: "$user",
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $project: {
                    _id: 0,
                    email: "$_id",
                    wins: 1,
                    totalPrize: 1,
                    name: { $ifNull: ["$user.name", "$_id"] },
                    photoURL: "$user.photoURL",
                    role: "$user.role",
                },
            },
        ];

        const leaderboard = await contestCollection.aggregate(pipeline).toArray();
        res.send(leaderboard);
    } catch (error) {
        console.error("Error fetching leaderboard:", error);
        res.status(500).send({ message: "Failed to load leaderboard" });
    }
});

// Creator: get all contests created by the logged-in user
app.get("/creator/contests", verifyToken, async (req, res) => {
    try {
        const email = req.decoded.email;
        const contests = await contestCollection
            .find({ creatorEmail: email }) // make sure you set this when creating contests
            .sort({ createdAt: -1 })
            .toArray();

        res.send(contests);
    } catch (error) {
        console.error("Error fetching creator contests:", error);
        res.status(500).send({ message: "Failed to fetch contests" });
    }
});

// Creator: delete own contest ONLY if still pending
app.delete("/creator/contests/:id", verifyToken, async (req, res) => {
    try {
        const email = req.decoded.email;
        const id = req.params.id;

        const filter = {
            _id: new ObjectId(id),
            creatorEmail: email,
            status: "pending", // only pending contests can be deleted
        };

        const result = await contestCollection.deleteOne(filter);

        if (result.deletedCount === 0) {
            return res
                .status(400)
                .send({
                    message:
                        "Only your own pending contests can be deleted or this contest no longer exists.",
                });
        }

        res.send(result);
    } catch (error) {
        console.error("Error deleting creator contest:", error);
        res.status(500).send({ message: "Failed to delete contest" });
    }
});
// Creator / authenticated: create contest (status = pending)
app.post("/contests", verifyToken, async (req, res) => {
    try {
        const contest = req.body;

        contest.participationCount = 0;
        contest.status = "pending";
        contest.createdAt = new Date();

        const result = await contestCollection.insertOne(contest);
        res.send(result);
    } catch (error) {
        console.error("Error creating contest:", error);
        res.status(500).send({ message: "Failed to create contest" });
    }
});

app.get("/contests/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const contest = await contestCollection.findOne({
            _id: new ObjectId(id),
        });

        if (!contest) {
            return res.status(404).send({ message: "Contest not found" });
        }

        res.send(contest);
    } catch (error) {
        console.error("Error fetching contest:", error);
        res.status(500).send({ message: "Failed to fetch contest" });
    }
});

app.patch(
    "/creator/contests/:id",
    verifyToken,
    async (req, res) => {
        try {
            const email = req.decoded.email;
            const id = req.params.id;
            const update = req.body;

            const filter = {
                _id: new ObjectId(id),
                creatorEmail: email,
                status: "pending", // only pending contests can be edited
            };

            const updateDoc = {
                $set: {
                    name: update.name,
                    image: update.image,
                    description: update.description,
                    price: update.price,
                    prizeMoney: update.prizeMoney,
                    taskInstruction: update.taskInstruction,
                    type: update.type,
                    deadline: update.deadline,
                },
            };

            const result = await contestCollection.updateOne(filter, updateDoc);
            res.send(result);
        } catch (error) {
            console.error("Error updating creator contest:", error);
            res.status(500).send({ message: "Failed to update contest" });
        }
    }
);

// Get submissions for a specific contest (creator only)
app.get(
    "/creator/contests/:id/submissions",
    verifyToken,
    async (req, res) => {
        try {
            const email = req.decoded.email;
            const contestId = req.params.id;

            // Ensure this contest belongs to the creator
            const contest = await contestCollection.findOne({
                _id: new ObjectId(contestId),
            });

            if (!contest) {
                return res.status(404).send({ message: "Contest not found" });
            }

            if (contest.creatorEmail !== email) {
                return res
                    .status(403)
                    .send({ message: "Forbidden: not your contest" });
            }

            const submissions = await submissionCollection
                .find({ contestId: contestId })
                .sort({ submittedAt: -1 })
                .toArray();

            res.send(submissions);
        } catch (error) {
            console.error("Error fetching submissions:", error);
            res
                .status(500)
                .send({ message: "Failed to fetch submissions" });
        }
    }
);

// Declare winner for a submission (only one winner per contest, creator only)
app.patch(
    "/creator/submissions/:id/winner",
    verifyToken,
    async (req, res) => {
        try {
            const email = req.decoded.email;
            const submissionId = req.params.id;
            const { contestId } = req.body;

            // 1. Find contest and verify ownership
            const contest = await contestCollection.findOne({
                _id: new ObjectId(contestId),
            });

            if (!contest) {
                return res.status(404).send({ message: "Contest not found" });
            }

            if (contest.creatorEmail !== email) {
                return res
                    .status(403)
                    .send({ message: "Forbidden: not your contest" });
            }

            // 2. Ensure no winner yet
            if (contest.winnerSubmissionId) {
                return res
                    .status(400)
                    .send({ message: "Winner already declared for this contest" });
            }

            // 3. Fetch submission
            const submission = await submissionCollection.findOne({
                _id: new ObjectId(submissionId),
                contestId: contestId,
            });

            if (!submission) {
                return res
                    .status(404)
                    .send({ message: "Submission not found" });
            }

            // 4. Mark submission as winner
            const updateSubmission = await submissionCollection.updateOne(
                { _id: new ObjectId(submissionId) },
                { $set: { isWinner: true } }
            );

            // 5. Update contest winner info
            const updateContest = await contestCollection.updateOne(
                { _id: new ObjectId(contestId) },
                {
                    $set: {
                        winnerSubmissionId: submission._id,
                        winnerUserEmail: submission.userEmail,
                        winnerUserName: submission.userName,
                    },
                }
            );

            res.send({
                modifiedCount:
                    updateSubmission.modifiedCount + updateContest.modifiedCount,
            });
        } catch (error) {
            console.error("Error declaring winner:", error);
            res
                .status(500)
                .send({ message: "Failed to declare winner" });
        }
    }
);

// Submit task for a contest (only for logged-in users; you may also check registration)
app.post("/contests/:id/submissions", verifyToken, async (req, res) => {
    try {
        const email = req.decoded.email;
        const contestId = req.params.id;
        const { content, userName } = req.body;

        if (!content || !content.trim()) {
            return res
                .status(400)
                .send({ message: "Submission content is required" });
        }

        // ensure user is registered for this contest
        const payment = await paymentCollection.findOne({
            userEmail: email,
            contestId: new ObjectId(contestId),
            paymentStatus: "paid",
        });

        if (!payment) {
            return res
                .status(403)
                .send({ message: "You must register for this contest before submitting" });
        }

        const submission = {
            contestId,
            userEmail: email,
            userName: userName || email,
            content,
            submittedAt: new Date(),
            isWinner: false,
        };

        const result = await submissionCollection.insertOne(submission);
        res.send(result);
    } catch (error) {
        console.error("Error submitting task:", error);
        res.status(500).send({ message: "Failed to submit task" });
    }
});

// ---------- ADMIN CONTEST ROUTES ----------

// Get contests with pagination (admin only)
app.get("/admin/contests", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const status = req.query.status; // optional filter: pending/approved/rejected
        const filter = {};
        if (status) {
            filter.status = status;
        }

        const total = await contestCollection.countDocuments(filter);
        const contests = await contestCollection
            .find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        res.send({
            contests,
            total,
            page,
            totalPages: Math.ceil(total / limit),
        });
    } catch (error) {
        console.error("Error fetching contests:", error);
        res.status(500).send({ message: "Failed to fetch contests" });
    }
});

// Change contest status (Confirm / Reject) – admin only
app.patch(
    "/admin/contests/:id/status",
    verifyToken,
    verifyAdmin,
    async (req, res) => {
        try {
            const id = req.params.id;
            const { status } = req.body; // 'approved' | 'rejected'

            const validStatuses = ["pending", "approved", "rejected"];
            if (!validStatuses.includes(status)) {
                return res.status(400).send({ message: "Invalid status" });
            }

            const filter = { _id: new ObjectId(id) };
            const updateDoc = { $set: { status } };

            const result = await contestCollection.updateOne(filter, updateDoc);
            res.send(result);
        } catch (error) {
            console.error("Error updating contest status:", error);
            res
                .status(500)
                .send({ message: "Failed to update contest status" });
        }
    }
);

// Delete contest – admin only
app.delete(
    "/admin/contests/:id",
    verifyToken,
    verifyAdmin,
    async (req, res) => {
        try {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const result = await contestCollection.deleteOne(filter);
            res.send(result);
        } catch (error) {
            console.error("Error deleting contest:", error);
            res.status(500).send({ message: "Failed to delete contest" });
        }
    }
);

// Get current user's profile
app.get("/users/me", verifyToken, async (req, res) => {
    try {
        const email = req.decoded.email;
        const user = await userCollection.findOne(
            { email },
            { projection: { password: 0 } }
        );
        res.send(user || {});
    } catch (error) {
        console.error("Error fetching profile:", error);
        res.status(500).send({ message: "Failed to fetch profile" });
    }
});

// Update current user's profile (name, photoURL, bio)
app.patch("/users/profile", verifyToken, async (req, res) => {
    try {
        const email = req.decoded.email;
        const { name, photoURL, bio } = req.body;

        const updateDoc = {
            $set: {
                ...(name && { name }),
                ...(photoURL && { photoURL }),
                ...(bio !== undefined && { bio }),
            },
        };

        const result = await userCollection.updateOne({ email }, updateDoc);
        res.send(result);
    } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).send({ message: "Failed to update profile" });
    }
});

// Get stats for current user: participated contests & wins
app.get("/users/stats", verifyToken, async (req, res) => {
    try {
        const email = req.decoded.email;

        // participated
        const participated = await paymentCollection.countDocuments({
            userEmail: email,
        });

        // number of winning submissions
        const wins = await submissionCollection.countDocuments({
            userEmail: email,
            isWinner: true,
        });

        res.send({ participated, wins });
    } catch (error) {
        console.error("Error fetching user stats:", error);
        res.status(500).send({ message: "Failed to fetch user stats" });
    }
});

// Get all contests where the current user is the declared winner
app.get("/users/wins", verifyToken, async (req, res) => {
    try {
        const email = req.decoded.email;

        // in the /creator/submissions/:id/winner route
        const wins = await contestCollection
            .find({ winnerUserEmail: email })
            .sort({ deadline: -1 }) // most recent deadlines first
            .toArray();

        res.send(wins);
    } catch (error) {
        console.error("Error fetching winning contests:", error);
        res.status(500).send({ message: "Failed to fetch winning contests" });
    }
});

//PaymentIntent for a contest (logged-in user)
app.post("/payments/create-intent", verifyToken, async (req, res) => {
    try {
        const { contestId } = req.body;

        if (!contestId) {
            return res.status(400).send({ message: "contestId is required" });
        }

        const contest = await contestCollection.findOne({
            _id: new ObjectId(contestId),
        });

        if (!contest) {
            return res.status(404).send({ message: "Contest not found" });
        }

        if (typeof contest.price !== "number" || contest.price <= 0) {
            return res
                .status(400)
                .send({ message: "Invalid contest price for payment" });
        }

        const amount = Math.round(contest.price * 100);

        const paymentIntent = await stripe.paymentIntents.create({
            amount,
            currency: "usd",
            automatic_payment_methods: {
                enabled: true,
            },
        });

        res.send({
            clientSecret: paymentIntent.client_secret,
        });
    } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).send({ message: "Failed to create payment intent" });
    }
});

// Save payment info and update participants (after successful Stripe payment)
app.post("/payments", verifyToken, async (req, res) => {
    try {
        const email = req.decoded.email;
        const payment = req.body;
        const { contestId, amount, transactionId } = payment;

        if (!contestId || !amount || !transactionId) {
            return res
                .status(400)
                .send({ message: "contestId, amount and transactionId are required" });
        }

        const contestObjectId = new ObjectId(contestId);

        const paymentDoc = {
            userEmail: email,
            contestId: contestObjectId,
            amount,
            transactionId,
            paymentStatus: "paid",
            paidAt: new Date(),
        };

        const paymentResult = await paymentCollection.insertOne(paymentDoc);

        // Increase participants count on contest
        const updateContest = await contestCollection.updateOne(
            { _id: contestObjectId },
            { $inc: { participationCount: 1 } }
        );

        res.send({
            paymentResult,
            updateContest,
        });
    } catch (error) {
        console.error("Error saving payment:", error);
        res.status(500).send({ message: "Failed to save payment" });
    }
});
// Get all contests the current user has paid for
app.get("/payments/my", verifyToken, async (req, res) => {
    try {
        const email = req.decoded.email;


        const payments = await paymentCollection
            .aggregate([
                {
                    $match: {
                        userEmail: email,
                        paymentStatus: "paid", // change if you use another status field
                    },
                },
                {
                    $lookup: {
                        from: "contests",
                        localField: "contestId",
                        foreignField: "_id",
                        as: "contest",
                    },
                },
                { $unwind: "$contest" },
            ])
            .toArray();

        res.send(payments);
    } catch (error) {
        console.error("Error fetching user payments:", error);
        res.status(500).send({ message: "Failed to fetch participated contests" });
    }
});

// Check if current user has paid (registered) for a specific contest
app.get("/payments/registered/:contestId", verifyToken, async (req, res) => {
    try {
        const email = req.decoded.email;
        const contestId = req.params.contestId;

        const payment = await paymentCollection.findOne({
            userEmail: email,
            contestId: new ObjectId(contestId),
            paymentStatus: "paid",
        });

        res.send({ registered: !!payment });
    } catch (error) {
        console.error("Error checking registration:", error);
        res.status(500).send({ message: "Failed to check registration" });
    }
});

// Root route
app.get("/", (req, res) => {
    res.send("ContestHub Server is running");
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server is running on port ${port}`);
    });
}

module.exports = app;