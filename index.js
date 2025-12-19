const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

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

    const db = client.db("civic_care_db");
    const issuesCollection = db.collection("issues");
    const usersCollection = db.collection("users");

    const timelineCollection = db.collection("timeline");

    // user related apis

    app.get("/users", async (req, res) => {
  try {
    const users = await usersCollection.find().sort({ createdAt: -1 }).toArray();
    res.send(users);
  } catch (err) {
    res.status(500).send({ message: "Failed to load users" });
  }
});

    app.post("/users", async (req, res) => {
  try {
    const { email, name, photoURL } = req.body;

    if (!email) {
      return res.status(400).send({ message: "Email is required" });
    }

    const existingUser = await usersCollection.findOne({ email });

    // If user already exists, do nothing
    if (existingUser) {
      return res.send({ success: true, message: "User already exists" });
    }

    const newUser = {
      email,
      name: name || "",
      photoURL: photoURL || "",
      role: "citizen",      // ✅ default role
      isBlocked: false,
      isPremium: false,
      createdAt: new Date(),
    };

    await usersCollection.insertOne(newUser);

    res.send({ success: true, message: "User created successfully" });
  } catch (error) {
    res.status(500).send({ message: "Failed to create user" });
  }
});

app.get("/users/role/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const user = await usersCollection.findOne(
      { email },
      { projection: { role: 1, email: 1, isBlocked: 1, isPremium: 1 } }
    );

    if (!user) {
      return res.status(404).send({ message: "User not found" });
    }

    res.send(user);
  } catch (error) {
    res.status(500).send({ message: "Failed to get user role" });
  }
});

app.patch("/users/role", async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email || !role) {
      return res.status(400).send({ message: "Email and role are required" });
    }

    const allowedRoles = ["citizen", "staff", "admin"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).send({ message: "Invalid role" });
    }

    const result = await usersCollection.updateOne(
      { email },
      { $set: { role, updatedAt: new Date() } }
    );

    res.send({
      success: true,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    res.status(500).send({ message: "Failed to update role" });
  }
});


   
    app.get("/", (req, res) => {
      res.send("CivicCare Server is running");
    });

    // ✅ GET all issues (server-side pagination + search + filter + boosted first)
    app.get("/issues", async (req, res) => {
      try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 9, 1), 50);
        const skip = (page - 1) * limit;

        const search = (req.query.search || "").trim();
        const category = (req.query.category || "").trim();
        const status = (req.query.status || "").trim();
        const priority = (req.query.priority || "").trim();

        const filter = {};

        // exact filters
        if (category && category !== "all") filter.category = category;
        if (status && status !== "all") filter.status = status;
        if (priority && priority !== "all") filter.priority = priority;

        // search (title/category/location)
        if (search) {
          const regex = new RegExp(search, "i");
          filter.$or = [{ title: regex }, { category: regex }, { location: regex }];
        }

        const total = await issuesCollection.countDocuments(filter);

        const issues = await issuesCollection
          .find(filter)
          .sort({ isBoosted: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({
          issues,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch issues" });
      }
    });

    // ✅ GET issue by id (details page) - FIXED for your IssueDetails.jsx
    // Your client expects: issueData.issue and issue.timeline
    app.get("/issues/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
        if (!issue) return res.status(404).send({ message: "Issue not found" });

        // timeline is stored in separate collection as: { issueId, entries: [...] }
        const timelineDoc = await timelineCollection.findOne({ issueId: id });

        const issueWithTimeline = {
          ...issue,
          timeline: timelineDoc?.entries || [],
        };

        // IMPORTANT: wrap as { issue: ... } because your client uses issueData?.issue
        res.send({ issue: issueWithTimeline });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch issue" });
      }
    });

    // ✅ POST create issue
    app.post("/issues", async (req, res) => {
      try {
        const issueData = {
          ...req.body,
          createdAt: new Date(),
          status: req.body?.status || "pending",
          priority: req.body?.priority || "normal",
          upvoteCount: 0,
          upvotedBy: [],
        };

        const result = await issuesCollection.insertOne(issueData);

        // create timeline entry
        if (result.insertedId) {
          const timelineEntry = {
            issueId: result.insertedId.toString(),
            entries: [
              {
                status: "pending",
                message: "Issue reported by citizen",
                updatedBy: issueData.reportedByName || issueData.reportedBy,
                updatedByEmail: issueData.reportedBy || issueData.userEmail,
                role: "citizen",
                date: new Date().toISOString(),
              },
            ],
          };
          await timelineCollection.insertOne(timelineEntry);
        }

        res.send({
          success: true,
          insertedId: result.insertedId,
          message: "Issue created successfully",
        });
      } catch (err) {
        res.status(500).send({ message: "Failed to create issue" });
      }
    });

    // ✅ DELETE issue (IssueDetails.jsx calls this)
    app.delete("/issues/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const deleteResult = await issuesCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (deleteResult.deletedCount === 0) {
          return res.status(404).send({ message: "Issue not found" });
        }

        // optional: also delete timeline record
        await timelineCollection.deleteOne({ issueId: id });

        res.send({ success: true, message: "Issue deleted successfully" });
      } catch (err) {
        res.status(500).send({ message: "Failed to delete issue" });
      }
    });

    // ✅ PATCH upvote (rules enforced) - FIXED response shape for IssueDetails.jsx
    app.patch("/issues/:id/upvote", async (req, res) => {
      try {
        const { id } = req.params;
        const { userEmail } = req.body;

        if (!userEmail) {
          return res.status(401).send({ message: "Login required" });
        }

        const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
        if (!issue) return res.status(404).send({ message: "Issue not found" });

        // cannot upvote own issue
        const ownerEmail = issue.userEmail || issue.reportedBy;
        if (ownerEmail && ownerEmail === userEmail) {
          return res.status(403).send({ message: "You cannot upvote your own issue" });
        }

        // only once
        if (issue.upvotedBy?.includes(userEmail)) {
          return res.status(409).send({ message: "Already upvoted" });
        }

        const updateResult = await issuesCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $inc: { upvoteCount: 1 },
            $addToSet: { upvotedBy: userEmail },
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res.status(400).send({ message: "Upvote failed" });
        }

        const updatedIssue = await issuesCollection.findOne({
          _id: new ObjectId(id),
        });

        // return message + issue (IssueDetails uses data.message)
        res.send({
          message: "Upvoted successfully",
          issue: updatedIssue,
        });
      } catch (err) {
        res.status(500).send({ message: "Failed to upvote" });
      }
    });

    console.log("✅ Connected to MongoDB!");
  } finally {
    // keep running
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
