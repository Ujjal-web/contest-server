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
            // (JWT verification logic)
        }

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