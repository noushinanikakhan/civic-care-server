const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

/* =========================
   ✅ MIDDLEWARE (IMPORTANT)
   Fix 413 Payload Too Large
   ========================= */
app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

/* =========================
   ✅ MONGODB CONNECTION
   ========================= */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.a0a09os.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB!");

    const db = client.db("civic_care_db");

    // ✅ Collections
    const usersCollection = db.collection("users");
    const issuesCollection = db.collection("issues");

    /* =========================================================
       ✅ USERS ROUTES
       ========================================================= */

    // ✅ OPTIONAL: view users in browser (prevents "Cannot GET /users")
    app.get("/users", async (req, res) => {
      try {
        const users = await usersCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.send(users);
      } catch (err) {
        res.status(500).send({ message: "Failed to load users" });
      }
    });

    // ✅ CREATE USER (called from AuthProvider after login/register/google)
    app.post("/users", async (req, res) => {
      try {
        const { email, name, photoURL } = req.body;

        if (!email) {
          return res.status(400).send({ message: "Email is required" });
        }

        const existingUser = await usersCollection.findOne({ email });

        if (existingUser) {
          return res.send({ success: true, message: "User already exists" });
        }

        const userDoc = {
          email,
          name: name || "",
          photoURL: photoURL || "",
          role: "citizen",
          isBlocked: false,
          isPremium: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await usersCollection.insertOne(userDoc);
        res.send({ success: true, message: "User created successfully" });
      } catch (err) {
        res.status(500).send({ message: "Failed to create user" });
      }
    });

    // ✅ PROFILE DATA FOR DASHBOARD PROFILE PAGE
    app.get("/users/profile/:email", async (req, res) => {
      try {
        const email = req.params.email;

        const user = await usersCollection.findOne(
          { email },
          {
            projection: {
              email: 1,
              name: 1,
              photoURL: 1,
              role: 1,
              isBlocked: 1,
              isPremium: 1,
              createdAt: 1,
            },
          }
        );

        if (!user) return res.status(404).send({ message: "User not found" });

        res.send(user);
      } catch (err) {
        res.status(500).send({ message: "Failed to load profile" });
      }
    });

    // ✅ UPDATE ROLE (for testing staff/admin; you will secure later)
    app.patch("/users/role", async (req, res) => {
      try {
        const { email, role } = req.body;

        if (!email || !role) {
          return res
            .status(400)
            .send({ message: "Email and role are required" });
        }

        const allowedRoles = ["citizen", "staff", "admin"];
        if (!allowedRoles.includes(role)) {
          return res.status(400).send({ message: "Invalid role" });
        }

        const result = await usersCollection.updateOne(
          { email },
          { $set: { role, updatedAt: new Date() } }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (err) {
        res.status(500).send({ message: "Failed to update role" });
      }
    });

    /* =========================================================
       ✅ ISSUES ROUTES
       ========================================================= */

    // ✅ GET issues (pagination + search + filters + reportedBy)
    app.get("/issues", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const skip = (page - 1) * limit;

        const search = (req.query.search || "").trim();
        const category = (req.query.category || "all").trim();
        const status = (req.query.status || "all").trim();
        const priority = (req.query.priority || "all").trim();

        // ✅ THIS is the line you asked where to put:
        const reportedBy = (req.query.reportedBy || "").trim();

        const filter = {};

        if (category !== "all") filter.category = category;
        if (status !== "all") filter.status = status;
        if (priority !== "all") filter.priority = priority;

        // ✅ my issues filter
        if (reportedBy) filter.reportedBy = reportedBy;

        // ✅ search by title/category/location
        if (search) {
          const regex = new RegExp(search, "i");
          filter.$or = [{ title: regex }, { category: regex }, { location: regex }];
        }

        // ✅ boosted issues first
        const sortOption = { priority: -1, createdAt: -1 };

        // If you store priority as string ("high"/"normal"), you can sort later.
        // For now keep createdAt sort:
        const total = await issuesCollection.countDocuments(filter);

        const issues = await issuesCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({ total, page, limit, issues });
      } catch (err) {
        res.status(500).send({ message: "Failed to load issues" });
      }
    });

    // ✅ GET single issue details
    app.get("/issues/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });

        if (!issue) return res.status(404).send({ message: "Issue not found" });

        res.send(issue);
      } catch (err) {
        res.status(500).send({ message: "Failed to load issue details" });
      }
    });

    // ✅ POST create issue
    app.post("/issues", async (req, res) => {
      try {
        const issueData = {
          ...req.body,
          upvoteCount: 0,
          upvotedBy: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // basic validation
        if (!issueData.title || !issueData.category || !issueData.location || !issueData.description) {
          return res.status(400).send({ message: "Required fields missing" });
        }

        if (!issueData.reportedBy) {
          return res.status(400).send({ message: "reportedBy is required" });
        }

        const result = await issuesCollection.insertOne(issueData);
        res.send({ success: true, insertedId: result.insertedId });
      } catch (err) {
        res.status(500).send({ message: "Failed to create issue" });
      }
    });

    /* =========================================================
       ✅ THIS IS WHERE YOUR PATCH ROUTE GOES
       (After POST /issues, before DELETE /issues/:id)
       ========================================================= */

    // ✅ PATCH update issue (Edit)
    app.patch("/issues/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updateData = req.body || {};

        const allowedFields = [
          "title",
          "category",
          "location",
          "priority",
          "description",
          "image",
        ];

        const $set = {};
        for (const key of allowedFields) {
          if (updateData[key] !== undefined) {
            $set[key] = updateData[key];
          }
        }

        if (Object.keys($set).length === 0) {
          return res.status(400).send({ message: "No valid fields to update" });
        }

        $set.updatedAt = new Date();

        const result = await issuesCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set },
          { returnDocument: "after" }
        );

        if (!result.value) {
          return res.status(404).send({ message: "Issue not found" });
        }

        res.send({ success: true, issue: result.value });
      } catch (err) {
        res.status(500).send({ message: "Failed to update issue" });
      }
    });

    // ✅ DELETE issue
    app.delete("/issues/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await issuesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({ message: "Issue not found" });
        }

        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (err) {
        res.status(500).send({ message: "Failed to delete issue" });
      }
    });

    // ✅ UPVOTE (rules: only once, cannot upvote own issue)
    app.post("/issues/:id/upvote", async (req, res) => {
      try {
        const id = req.params.id;
        const { email } = req.body; // user who is upvoting

        if (!email) {
          return res.status(401).send({ message: "Login required" });
        }

        const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
        if (!issue) return res.status(404).send({ message: "Issue not found" });

        if (issue.reportedBy === email) {
          return res.status(403).send({ message: "You cannot upvote your own issue" });
        }

        if ((issue.upvotedBy || []).includes(email)) {
          return res.status(409).send({ message: "You already upvoted this issue" });
        }

        const result = await issuesCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $inc: { upvoteCount: 1 },
            $push: { upvotedBy: email },
            $set: { updatedAt: new Date() },
          }
        );

        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (err) {
        res.status(500).send({ message: "Failed to upvote" });
      }
    });

    /* =========================
       ✅ ROOT CHECK
       ========================= */
    app.get("/", (req, res) => {
      res.send("CivicCare Server is running");
    });
  } finally {
    // Do not close client here (keep server alive)
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
