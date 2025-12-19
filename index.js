const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// --------- Middleware ----------
app.use(
    cors({
        origin: ["http://localhost:5173"],
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

async function run() {
    try {
        await client.connect();
        const db = client.db("contestHubDB");
        const userCollection = db.collection("users");
        const contestCollection = db.collection("contests");
        const submissionCollection = db.collection("submissions");
        const paymentCollection = db.collection("payments");

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

        // Public: Get contests (search + type filter, only approved)
        app.get("/contests", async (req, res) => {
            const search = req.query.search || "";
            const type = req.query.type;

            const query = {
                name: { $regex: search, $options: "i" },
                status: "approved",
            };

            if (type) {
                query.type = type;
            }

            try {
                const result = await contestCollection.find(query).toArray();
                res.send(result);
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

        app.post("/contests/:id/submissions", verifyToken, async (req, res) => {
            try {
                const contestId = req.params.id;
                const email = req.decoded.email;
                const { content, userName } = req.body; // userName optional

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
        // Get all contests the current user has paid for
        app.get("/payments/my", verifyToken, async (req, res) => {
            try {
                const email = req.decoded.email;

                // Adjust field names to match your payment schema
                // Assumes:
                // - payments have { userEmail, contestId: ObjectId, amount, paymentStatus, paidAt }
                // - contests collection has _id, name, type, deadline, price, prizeMoney, image
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
        // --------- MongoDB Ping ----------
        await client.db("admin").command({ ping: 1 });
        console.log("Successfully connected to MongoDB!");
    } finally {
    }
}
run().catch(console.dir);

// Root route
app.get("/", (req, res) => {
    res.send("ContestHub Server is running");
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});