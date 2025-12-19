const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nseft0p.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

app.post("/jwt", async (req, res) => {
    const user = req.body; // { email }
    if (!user?.email) {
        return res.status(400).send({ message: "Email is required" });
    }

    const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "7d",
    });

    res.send({ token });
});

async function run() {
    try {

        const db = client.db("contestHubDB");
        const userCollection = db.collection("users");
        const contestCollection = db.collection("contests");
        const paymentCollection = db.collection("payments");

        const verifyToken = (req, res, next) => {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).send({ message: "Unauthorized access" });
            }

            const token = authHeader.split(" ")[1];

            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(403).send({ message: "Forbidden access" });
                }
                req.decoded = decoded;
                next();
            });
        };

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

        // ----- USER ROUTES -----

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
                const updateDoc = {
                    $set: { role },
                };

                const result = await userCollection.updateOne(filter, updateDoc);
                res.send(result);
            } catch (error) {
                console.error("Error updating role:", error);
                res.status(500).send({ message: "Failed to update user role" });
            }
        });

        // Create user (called from frontend register/Google signup)
        app.post("/users", async (req, res) => {
            const user = req.body; // { name, email, photoURL, role, rolePreference? }

            if (!user?.email) {
                return res.status(400).send({ message: "Email is required" });
            }

            try {
                // Check if user already exists
                const existing = await userCollection.findOne({ email: user.email });
                if (existing) {
                    // Do NOT override existing role; just return
                    return res.send({
                        message: "User already exists",
                        insertedId: null,
                    });
                }

                // Set default role if not provided
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

        // Get role of a user by email
        app.get("/users/role/:email", async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email });

            // Default role is 'user' if not found
            const role = user?.role || "user";
            res.send({ role });
        });

        // ----- CONTEST ROUTES -----

        app.get("/contests", async (req, res) => {
            const search = req.query.search || "";
            const type = req.query.type;

            let query = {
                name: { $regex: search, $options: "i" },
                status: "approved",
            };

            if (type) {
                query.type = type;
            }

            const result = await contestCollection.find(query).toArray();
            res.send(result);
        });

        app.get("/contests/popular", async (req, res) => {
            const result = await contestCollection
                .find({ status: "approved" })
                .sort({ participationCount: -1 })
                .limit(6)
                .toArray();
            res.send(result);
        });

        // Protected: only logged-in users can create contests
        app.post("/contests", verifyToken, async (req, res) => {
            const contest = req.body;

            contest.participationCount = 0;
            contest.status = "pending";
            contest.createdAt = new Date();

            const result = await contestCollection.insertOne(contest);
            res.send(result);
        });




        //..... API ROUTES ---
        app.get('/contests', async (req, res) => {
            const search = req.query.search || "";
            const type = req.query.type;

            let query = {
                name: { $regex: search, $options: 'i' },
                status: 'approved'
            };

            if (type) {
                query.type = type;
            }

            const result = await contestCollection.find(query).toArray();
            res.send(result);
        });

        app.get('/contests/popular', async (req, res) => {
            const result = await contestCollection
                .find({ status: 'approved' })
                .sort({ participationCount: -1 })
                .limit(6)
                .toArray();
            res.send(result);
        });

        app.post('/contests', verifyToken, async (req, res) => {
            const contest = req.body;
            contest.participationCount = 0;
            contest.status = 'pending';
            const result = await contestCollection.insertOne(contest);
            res.send(result);
        });


        await client.db("admin").command({ ping: 1 });
        console.log("Successfully connected to MongoDB!");

    } finally {
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('ContestHub Server is running');
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});