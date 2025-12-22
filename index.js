const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");


    // Firebase Admin (server only)
  
const admin = require("firebase-admin");

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(
      Buffer.from(raw, "base64").toString("utf8")
    );
  } catch (e) {
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT base64");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}



const app = express();
const port = process.env.PORT || 3000;

/* =========================
   ✅ MIDDLEWARE
   ========================= */
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));


app.get("/", (req, res) => {
  res.send("✅ CivicCare Server is running");
});

/* =========================
   ✅ VERIFY TOKEN (Firebase ID Token)
   ========================= */
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .send({ success: false, message: "Unauthorized (no token)" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(token);

    // ✅ keep your current approach
    req.decoded = decoded;

    next();
  } catch (err) {
    console.error("Token verification error:", err.message);
    return res
      .status(401)
      .send({ success: false, message: "Unauthorized (invalid token)" });
  }
};

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
    // await client.connect();
    console.log("✅ Connected to MongoDB!");

    const db = client.db("civic_care_db");
    const usersCollection = db.collection("users");
    const issuesCollection = db.collection("issues");

    // ✅ indexes (safe + helpful)
    // await usersCollection.createIndex({ email: 1 }, { unique: true });

    // // these help sorting/filtering
    // await issuesCollection.createIndex({ createdAt: -1 });
    // await issuesCollection.createIndex({ category: 1 });
    // await issuesCollection.createIndex({ status: 1 });
    // await issuesCollection.createIndex({ priority: 1, createdAt: -1 });

    // // helps "my issues" fast
    // await issuesCollection.createIndex({ reportedBy: 1, createdAt: -1 });
    // await issuesCollection.createIndex({ "reportedBy.email": 1, createdAt: -1 });
    // await issuesCollection.createIndex({ userEmail: 1, createdAt: -1 });

    // console.log("✅ Database indexes created");

    
      //   ROLE HELPERS
    
    const requireAdmin = async (req, res, next) => {
      const tokenEmail = req.decoded?.email;
      console.log("🔍 Admin check for:", tokenEmail);

      const user = await usersCollection.findOne({ email: tokenEmail });
      console.log(
        "🔍 User found:",
        user ? { email: user.email, role: user.role } : "Not found"
      );

      if (!user || user.role !== "admin") {
        console.log("❌ Admin access denied. Role:", user?.role);
        return res
          .status(403)
          .send({ success: false, message: "Admin access required" });
      }

      req.requester = user;
      next();
    };

    const requireStaff = async (req, res, next) => {
      const tokenEmail = req.decoded?.email;
      const user = await usersCollection.findOne({ email: tokenEmail });
      if (!user || user.role !== "staff") {
        return res
          .status(403)
          .send({ success: false, message: "Staff access required" });
      }
      req.requester = user;
      next();
    };

    /* =========================
       ✅ ROOT + HEALTH
       ========================= */
    // app.get("/", (req, res) => res.send("🚀 CivicCare Server is running"));

    // app.get("/health", async (req, res) => {
    //   try {
    //     // await client.db("admin").command({ ping: 1 });
    //     const usersCount = await usersCollection.countDocuments();
    //     const issuesCount = await issuesCollection.countDocuments();
    //     res.send({
    //       status: "healthy",
    //       database: "connected",
    //       collections: { users: usersCount, issues: issuesCount },
    //       timestamp: new Date().toISOString(),
    //     });
    //   } catch (error) {
    //     res.status(500).send({ status: "unhealthy", error: error.message });
    //   }
    // });

    

//  CREATE/UPSERT USER (registration + google + login safety)
// ✅ POST /users (create if not exists; update name/photo if provided)
app.post("/users", async (req, res) => {
  try {
    const { email, name, photoURL } = req.body;

    if (!email) {
      return res.status(400).send({ success: false, message: "Email is required" });
    }

    const existingUser = await usersCollection.findOne({ email });

    // ✅ CHANGED: if user exists, update ONLY if values provided (don’t overwrite photoURL with "")
    if (existingUser) {
      const $set = {
        updatedAt: new Date(),
        ...(name ? { name } : {}),
        ...(photoURL ? { photoURL } : {}), // ✅ PASTE HERE (this is the right place)
      };

      // if nothing to update, just return existing
      if (Object.keys($set).length === 1) {
        return res.send({
          success: true,
          message: "User already exists",
          user: existingUser,
        });
      }

      const updated = await usersCollection.findOneAndUpdate(
        { email },
        { $set },
        { returnDocument: "after" }
      );

      return res.send({
        success: true,
        message: "User updated",
        user: updated.value,
      });
    }

    // ✅ create new user
    const userDoc = {
      email,
      name: name || email.split("@")[0],
      photoURL: photoURL || "",
      role: "citizen",
      isPremium: false,
      isBlocked: false,
      issueCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(userDoc);

    res.status(201).send({
      success: true,
      message: "User created successfully",
      userId: result.insertedId,
      user: userDoc,
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).send({
      success: false,
      message: "Failed to create user",
      error: error.message,
    });
  }
});


//  GET USER PROFILE (secured) + safety auto-create requester
app.get("/users/profile/:email", verifyToken, async (req, res) => {
  try {
    const requestedEmail = (req.params.email || "").trim().toLowerCase();
    const tokenEmail = (req.decoded?.email || "").trim().toLowerCase();

    if (!tokenEmail) {
      return res
        .status(401)
        .send({ success: false, message: "Unauthorized (no email in token)" });
    }

// ✅ CHANGED: auto-create requester if missing (prevents "Requester not found")
let requester = await usersCollection.findOne({ email: tokenEmail });

if (!requester) {
  const fallbackDoc = {
    email: tokenEmail,
    name: tokenEmail.split("@")[0],
    photoURL: "",
    role: "citizen",
    isPremium: false,
    isBlocked: false,
    issueCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await usersCollection.updateOne(
    { email: tokenEmail },
    { $setOnInsert: fallbackDoc },
    { upsert: true }
  );

  requester = await usersCollection.findOne({ email: tokenEmail });
}


      requester = await usersCollection.findOne({ email: tokenEmail });
    }

    // ✅ Authorization: self or admin
    if (requester.email !== requestedEmail && requester.role !== "admin") {
      return res.status(403).send({
        success: false,
        message: "Forbidden: Cannot access other user's profile",
      });
    }

    const user = await usersCollection.findOne(
      { email: requestedEmail },
      {
        projection: {
          _id: 1,
          email: 1,
          name: 1,
          photoURL: 1,
          phone: 1,
          role: 1,
          isPremium: 1,
          isBlocked: 1,
          issueCount: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      }
    );

    if (!user) {
      return res
        .status(404)
        .send({ success: false, message: "User not found" });
    }

    res.send({ success: true, user });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).send({
      success: false,
      message: "Failed to load profile",
      error: error.message,
    });
  }
});



    //  UPDATE MY PROFILE (for admin/staff/citizen)
    app.patch("/users/profile", verifyToken, async (req, res) => {
      try {
        const email = req.decoded.email;
        const { name, photoURL, phone } = req.body || {};

        const $set = {};
        if (name !== undefined) $set.name = name;
        if (photoURL !== undefined) $set.photoURL = photoURL;
        if (phone !== undefined) $set.phone = phone;
        $set.updatedAt = new Date();

        if (Object.keys($set).length === 0) {
          return res
            .status(400)
            .send({ success: false, message: "No valid fields to update" });
        }

   const result = await usersCollection.findOneAndUpdate(
  { email },
  {
    $set,
    $setOnInsert: {
      email,
      role: "citizen",
      createdAt: new Date(),
      isBlocked: false,
      isPremium: false,
      issueCount: 0,
    },
  },
  { upsert: true, returnDocument: "after" }
);

res.send({
  success: true,
  message: "Profile updated",
  user: result.value,
});

      } catch (error) {
        console.error("Error updating profile:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update profile",
          error: error.message,
        });
      }
    });

    // GET ALL USERS (admin only)
    app.get("/users", verifyToken, requireAdmin, async (req, res) => {
      try {
        const users = await usersCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();
        res.send({ success: true, users, count: users.length });
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({
          success: false,
          message: "Failed to load users",
          error: error.message,
        });
      }
    });

    //  TOGGLE USER BLOCK (admin only)
    app.patch(
      "/users/:email/toggle-block",
      verifyToken,
      requireAdmin,
      async (req, res) => {
        try {
          const targetEmail = req.params.email;

          const targetUser = await usersCollection.findOne({ email: targetEmail });
          if (!targetUser)
            return res.status(404).send({ success: false, message: "User not found" });

          if ((targetUser.role || "").toLowerCase() === "admin") {
            return res
              .status(400)
              .send({ success: false, message: "Cannot block admin users" });
          }

          const newBlockStatus = !targetUser.isBlocked;

          await usersCollection.updateOne(
            { email: targetEmail },
            { $set: { isBlocked: newBlockStatus, updatedAt: new Date() } }
          );

          res.send({
            success: true,
            message: `User ${newBlockStatus ? "blocked" : "unblocked"} successfully`,
            isBlocked: newBlockStatus,
          });
        } catch (error) {
          console.error("Error toggling block status:", error);
          res.status(500).send({
            success: false,
            message: "Failed to update user",
            error: error.message,
          });
        }
      }
    );

    /* =========================
       ✅ PUBLIC ISSUES LIST (filters + pagination)
       ========================= */
    app.get("/issues", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const skip = (page - 1) * limit;

        const search = (req.query.search || "").trim();
        const category = (req.query.category || "all").trim();
        const status = (req.query.status || "all").trim();
        const priority = (req.query.priority || "all").trim();
        const reportedBy = (req.query.reportedBy || "").trim();

        const filter = {};
        if (category !== "all") filter.category = category;
        if (status !== "all") filter.status = status;
        if (priority !== "all") filter.priority = priority;

        // ✅ compatible with BOTH: string and object formats
        if (reportedBy) {
          filter.$or = [
            { reportedBy: reportedBy },
            { userEmail: reportedBy },
            { "reportedBy.email": reportedBy },
            { reportedByEmail: reportedBy },
          ];
        }

        if (search) {
          const regex = new RegExp(search, "i");
          filter.$or = [
            ...(filter.$or || []),
            { title: regex },
            { category: regex },
            { location: regex },
            { description: regex },
          ];
        }

        const total = await issuesCollection.countDocuments(filter);

        const issues = await issuesCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        const totalPages = Math.max(1, Math.ceil(total / limit));

        res.send({
          success: true,
          total,
          totalPages,
          page,
          limit,
          issues,
          hasMore: page < totalPages,
        });
      } catch (error) {
        console.error("❌ Error in /issues:", error);
        res
          .status(500)
          .send({ success: false, message: "Failed to load issues", error: error.message });
      }
    });

    // ✅ GET SINGLE ISSUE
    app.get("/issues/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ success: false, message: "Invalid issue ID format" });

        const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
        if (!issue) return res.status(404).send({ success: false, message: "Issue not found" });

        res.send({ success: true, issue });
      } catch (error) {
        console.error("Error fetching issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to load issue details",
          error: error.message,
        });
      }
    });

    /* =========================
       ✅ UPDATE ISSUE (Citizen can edit only own pending issue)
       ========================= */
    app.patch("/issues/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const email = req.decoded.email;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ success: false, message: "Invalid issue ID" });
        }

        const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
        if (!issue) return res.status(404).send({ success: false, message: "Issue not found" });

        // ✅ owner check compatible with BOTH structures
        const ownerEmail =
          typeof issue.reportedBy === "string" ? issue.reportedBy : issue?.reportedBy?.email;

        if (ownerEmail !== email) {
          return res.status(403).send({ success: false, message: "Forbidden: Not your issue" });
        }

        // only pending editable
        if ((issue.status || "").toLowerCase() !== "pending") {
          return res
            .status(400)
            .send({ success: false, message: "Only pending issues can be edited" });
        }

        const { title, description, category, location, image, priority } = req.body || {};

        const $set = { updatedAt: new Date() };
        if (title !== undefined) $set.title = title;
        if (description !== undefined) $set.description = description;
        if (category !== undefined) $set.category = category;
        if (location !== undefined) $set.location = location;
        if (priority !== undefined) $set.priority = priority;

        // ✅ keep image as string (URL/base64/empty) — you can finalize later
        if (image !== undefined) $set.image = image;

        const timelineItem = {
          status: "pending",
          message: "Issue updated by citizen",
          updatedBy:
            issue?.reportedByName ||
            issue?.reportedBy?.name ||
            email,
          date: new Date(),
        };

        const result = await issuesCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set, $push: { timeline: timelineItem } },
          { returnDocument: "after" }
        );

        res.send({ success: true, message: "Issue updated", issue: result.value });
      } catch (error) {
        console.error("Error updating issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update issue",
          error: error.message,
        });
      }
    });

    /* =========================
       ✅ CREATE ISSUE (Citizen only)
       ========================= */
    app.post("/issues", verifyToken, async (req, res) => {
      try {
        const email = req.decoded.email;
        const user = await usersCollection.findOne({ email });

        if (!user) return res.status(404).send({ success: false, message: "User not found" });
        if (user.isBlocked)
          return res.status(403).send({ success: false, message: "Blocked users cannot report issues" });

        // Check if free user has exceeded limit
        if (!user.isPremium && (user.issueCount || 0) >= 3) {
          return res.status(400).send({
            success: false,
            message: "Free users can only report 3 issues. Please upgrade to premium.",
          });
        }

        const { title, description, category, location, image, priority } = req.body || {};

        if (!title || !description || !category || !location) {
          return res.status(400).send({ success: false, message: "All required fields must be filled" });
        }

        // ✅ IMPORTANT: store reportedBy as STRING to match your current DB
        const issueDoc = {
          title,
          description,
          category,
          location,
          image: image || "",
          priority: priority || "normal",
          status: "pending",

          // ✅ keep both fields compatible
          upvoteCount: 0,
          // upvotes: 0,
          upvotedBy: [],

          // ✅ string-based owner + extra fields (optional but useful)
          reportedBy: user.email,          // ✅ STRING
          userEmail: user.email,           // optional/legacy
          reportedByName: user.name || "", // optional
          reportedByPhotoURL: user.photoURL || "",

          assignedTo: null,
          timeline: [
            {
              status: "pending",
              message: "Issue reported",
              updatedBy: user.name || user.email,
              date: new Date(),
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await issuesCollection.insertOne(issueDoc);

        // Increment user's issue count
        await usersCollection.updateOne(
          { email },
          { $inc: { issueCount: 1 }, $set: { updatedAt: new Date() } }
        );

        res.status(201).send({
          success: true,
          message: "Issue reported successfully",
          issueId: result.insertedId,
          issue: issueDoc,
        });
      } catch (error) {
        console.error("Error creating issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to report issue",
          error: error.message,
        });
      }
    });

    /* =========================
       ✅ ADMIN ENDPOINTS
       ========================= */

    // ✅ GET STAFF LIST (admin only)
    app.get("/admin/staff", verifyToken, requireAdmin, async (req, res) => {
      try {
        const staff = await usersCollection
          .find(
            { role: "staff" },
            { projection: { email: 1, 
              name: 1, 
              photoURL: 1, 
              role: 1, 
              phone: 1,               // ✅ ADD THIS
            staffPassword: 1,       // ✅ ADD THIS
            isBlocked: 1,           // ✅ Optional but useful
            createdAt: 1            // ✅ Optional
            } }
          )
          .sort({ createdAt: -1 })
          .toArray();

        res.send({ success: true, staff });
      } catch (error) {
        console.error("Error loading staff:", error);
        res.status(500).send({
          success: false,
          message: "Failed to load staff",
          error: error.message,
        });
      }
    });

    // ✅ GET ALL ISSUES (admin only) — stable sort + allowDiskUse
    app.get("/admin/issues", verifyToken, requireAdmin, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // filters (keep simple, can expand later)
        const filter = {};

        const total = await issuesCollection.countDocuments(filter);

        // ✅ sort "high" first without memory crash
        const issues = await issuesCollection
          .aggregate(
            [
              { $match: filter },
              {
                $addFields: {
                  _priorityRank: {
                    $cond: [{ $eq: ["$priority", "high"] }, 1, 0],
                  },
                },
              },
              { $sort: { _priorityRank: -1, createdAt: -1 } },
              { $skip: skip },
              { $limit: limit },
            ],
            { allowDiskUse: true }
          )
          .toArray();

        const totalPages = Math.max(1, Math.ceil(total / limit));

        res.send({
          success: true,
          issues,
          total,
          page,
          limit,
          totalPages,
          hasMore: page < totalPages,
        });
      } catch (error) {
        console.error("❌ Error in /admin/issues:", error);
        res.status(500).send({
          success: false,
          message: "Failed to load admin issues",
          error: error.message,
        });
      }
    });

    // ✅ ASSIGN STAFF (admin only)
    app.patch("/admin/issues/:id/assign-staff", verifyToken, requireAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        const { staffEmail } = req.body || {};

        if (!ObjectId.isValid(id)) return res.status(400).send({ success: false, message: "Invalid issue ID" });
        if (!staffEmail) return res.status(400).send({ success: false, message: "staffEmail is required" });

        const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
        if (!issue) return res.status(404).send({ success: false, message: "Issue not found" });

        if (issue?.assignedTo?.email) {
          return res.status(400).send({ success: false, message: "This issue is already assigned" });
        }

        const staff = await usersCollection.findOne({ email: staffEmail, role: "staff" });
        if (!staff) return res.status(404).send({ success: false, message: "Staff user not found" });

        const assignedTo = {
          email: staff.email,
          name: staff.name || staff.email,
          photoURL: staff.photoURL || "",
          assignedAt: new Date(),
        };

        const timelineItem = {
          status: issue.status || "pending",
          message: `Issue assigned to staff: ${assignedTo.name}`,
          updatedBy: "Admin",
          date: new Date(),
        };

        const result = await issuesCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          {
            $set: { assignedTo, updatedAt: new Date() },
            $push: { timeline: timelineItem },
          },
          { returnDocument: "after" }
        );

        res.send({ success: true, message: "Staff assigned", issue: result.value });
      } catch (error) {
        console.error("Error assigning staff:", error);
        res.status(500).send({ success: false, message: "Failed to assign staff", error: error.message });
      }
    });

    // ✅ REJECT ISSUE (admin only)
    app.patch("/admin/issues/:id/reject", verifyToken, requireAdmin, async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).send({ success: false, message: "Invalid issue ID" });

        const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
        if (!issue) return res.status(404).send({ success: false, message: "Issue not found" });

        const status = (issue.status || "pending").toLowerCase();
        if (status !== "pending") {
          return res.status(400).send({ success: false, message: "Can only reject pending issues" });
        }

        const timelineItem = {
          status: "rejected",
          message: "Issue rejected by admin",
          updatedBy: "Admin",
          date: new Date(),
        };

        const result = await issuesCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          {
            $set: { status: "rejected", updatedAt: new Date() },
            $push: { timeline: timelineItem },
          },
          { returnDocument: "after" }
        );

        res.send({ success: true, message: "Issue rejected", issue: result.value });
      } catch (error) {
        console.error("Error rejecting issue:", error);
        res.status(500).send({ success: false, message: "Failed to reject issue", error: error.message });
      }
    });

    // ✅ GET ISSUE STATISTICS (admin only)
    app.get("/admin/stats", verifyToken, requireAdmin, async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalIssues = await issuesCollection.countDocuments();
        const pendingIssues = await issuesCollection.countDocuments({ status: "pending" });
//         const resolvedIssues = await issuesCollection.countDocuments({
//   status: { $in: ["resolved", "closed"] }
// });

// const inProgressIssues = await issuesCollection.countDocuments({
//   status: { $in: ["in-progress", "working"] }
// });

        const rejectedIssues = await issuesCollection.countDocuments({ status: "rejected" });

        const recentIssues = await issuesCollection.find().sort({ createdAt: -1 }).limit(6).toArray();
        const recentUsers = await usersCollection.find().sort({ createdAt: -1 }).limit(6).toArray();


      const resolvedIssues = await issuesCollection.countDocuments({
      status: { $regex: /resolved|closed/i }  // Match both "resolved" and "closed"
    });

    const inProgressIssues = await issuesCollection.countDocuments({
      status: { $regex: /in-progress|working/i }  // Match both "in-progress" and "working"
    })
    
    
        res.send({
          success: true,
          stats: {
            users: { total: totalUsers },
            issues: {
              total: totalIssues,
              pending: pendingIssues,
              resolved: resolvedIssues,
              inProgress: inProgressIssues,
              rejected: rejectedIssues,
              highPriority: await issuesCollection.countDocuments({ priority: "high" }),
            },
            payments: { totalReceived: 0 },
          },
          recentIssues,
          recentUsers,
        });
      } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).send({ success: false, message: "Failed to load admin stats", error: error.message });
      }
    });

    /* =========================
       ✅ CITIZEN ENDPOINTS
       ========================= */

    // ✅ GET MY ISSUES (citizen)
    app.get("/my-issues", verifyToken, async (req, res) => {
      try {
        // ✅ FIX: you do NOT have req.user; you have req.decoded
        const email = req.decoded.email;

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        // ✅ compatible with all historical shapes
        const filter = {
          $or: [
            { reportedBy: email },
            { userEmail: email },
            { reportedByEmail: email },
            { "reportedBy.email": email },
          ],
        };

        const total = await issuesCollection.countDocuments(filter);

        const issues = await issuesCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({ success: true, issues, total, page, limit });
      } catch (err) {
        console.error("Error in /my-issues:", err);
        res.status(500).send({ success: false, message: "Failed to load my issues" });
      }
    });

    // ✅ UPVOTE ISSUE (token required)
app.patch("/issues/:id/upvote", verifyToken, async (req, res) => {
  try {
    console.log("📝 Upvote request received");

    const { id } = req.params;
    const email = req.decoded.email;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid issue ID" });
    }

    const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
    if (!issue) {
      return res.status(404).send({ success: false, message: "Issue not found" });
    }

    const ownerEmail = issue.userEmail || issue.reportedBy;
    if (ownerEmail === email) {
      return res.status(400).send({
        success: false,
        message: "You cannot upvote your own issue",
      });
    }

    if (issue.upvotedBy?.includes(email)) {
      return res.status(400).send({
        success: false,
        message: "You have already upvoted this issue",
      });
    }

    await issuesCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $inc: { upvoteCount: 1 },
        $push: { upvotedBy: email },
        $set: { updatedAt: new Date() },
      }
    );

    res.send({
      success: true,
      message: "Issue upvoted",
      upvoteCount: (issue.upvoteCount || 0) + 1,
      hasUpvoted: true,
    });
  } catch (error) {
    console.error("❌ Error upvoting issue:", error);
    res.status(500).send({
      success: false,
      message: "Failed to upvote issue",
    });
  }
});

// UPVOTE ISSUE-details page (token required)

// app.patch("/issues/:id/upvote", verifyToken, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const email = req.decoded.email;

//     if (!ObjectId.isValid(id)) {
//       return res.status(400).send({ success: false, message: "Invalid issue ID" });
//     }

//     const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
//     if (!issue) {
//       return res.status(404).send({ success: false, message: "Issue not found" });
//     }

//     // ✅ owner check (STRING-based, consistent)
//     const ownerEmail = issue.reportedBy;
//     if (ownerEmail === email) {
//       return res.status(400).send({
//         success: false,
//         message: "You cannot upvote your own issue",
//       });
//     }

//     // ✅ prevent double upvote
//     if (issue.upvotedBy?.includes(email)) {
//       return res.status(400).send({
//         success: false,
//         message: "You have already upvoted this issue",
//       });
//     }

//     // ✅ atomic update
//     await issuesCollection.updateOne(
//       { _id: new ObjectId(id) },
//       {
//         $inc: { upvoteCount: 1 },
//         $push: { upvotedBy: email },
//         $set: { updatedAt: new Date() },
//       }
//     );

//     return res.send({
//       success: true,
//       message: "Issue upvoted",
//     });
//   } catch (error) {
//     console.error("❌ Error upvoting issue:", error);
//     res.status(500).send({
//       success: false,
//       message: "Failed to upvote issue",
//     });
//   }
// });

// issue delete

app.delete("/issues/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const email = (req.decoded?.email || "").trim().toLowerCase();

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ success: false, message: "Invalid issue id" });
    }

    // 1) Find issue
    const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });

    if (!issue) {
      return res.status(404).send({ success: false, message: "Issue not found" });
    }

    // 2) Check ownership (supports all shapes)
    const ownerEmail =
      (issue?.reportedBy?.email || issue?.reportedBy || issue?.userEmail || issue?.reportedByEmail || "")
        .toString()
        .trim()
        .toLowerCase();

    // 3) If you have usersCollection, allow admin too (optional but useful)
    let isAdmin = false;
    if (typeof usersCollection !== "undefined") {
      const requester = await usersCollection.findOne({ email });
      isAdmin = requester?.role === "admin";
    }

    if (!isAdmin && ownerEmail !== email) {
      return res.status(403).send({
        success: false,
        message: "Forbidden: you can only delete your own issues",
      });
    }

    // 4) Optional rule: only pending can be deleted (matches your UI)
    const status = (issue.status || "").toLowerCase();
    if (!isAdmin && status !== "pending") {
      return res.status(403).send({
        success: false,
        message: "Only pending issues can be deleted",
      });
    }

    // 5) Delete
    const result = await issuesCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(500).send({ success: false, message: "Delete failed" });
    }

    res.send({ success: true, message: "Issue deleted successfully" });
  } catch (err) {
    console.error("Error deleting issue:", err);
    res.status(500).send({ success: false, message: "Failed to delete issue" });
  }
});



 /* =========================
       ✅ Payment ENDPOINTS
       ========================= */

       // payments collection
const paymentsCollection = db.collection("payments");

// ✅ USER: pay 1000tk & become premium
app.post("/payments/subscribe", verifyToken, async (req, res) => {
  try {
    const email = req.decoded.email;
    const user = await usersCollection.findOne({ email });

    if (!user) return res.status(404).send({ success: false, message: "User not found" });
    if (user.isBlocked) return res.status(403).send({ success: false, message: "Blocked users cannot subscribe" });
    if (user.isPremium) return res.status(400).send({ success: false, message: "Already premium" });

    // For assignment: accept transactionId from client or generate one
    const { transactionId, method } = req.body || {};
    const trx = transactionId || `TRX-${Date.now()}`;

    const paymentDoc = {
      email,
      amount: 1000,
      method: method || "assignment",
      transactionId: trx,
      createdAt: new Date(),
      monthKey: new Date().toISOString().slice(0, 7), // "YYYY-MM"
    };

    await paymentsCollection.insertOne(paymentDoc);

    await usersCollection.updateOne(
      { email },
      { $set: { isPremium: true, updatedAt: new Date() } }
    );

    res.status(201).send({
      success: true,
      message: "Payment successful. You are now premium.",
      payment: paymentDoc,
    });
  } catch (error) {
    console.error("Error subscribing:", error);
    res.status(500).send({ success: false, message: "Subscription failed", error: error.message });
  }
});

// ✅ USER: see my payments
app.get("/payments/my", verifyToken, async (req, res) => {
  try {
    const email = req.decoded.email;
    const payments = await paymentsCollection
      .find({ email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send({ success: true, payments });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to load payments" });
  }
});

// ✅ ADMIN: see all payments (filters)
app.get("/admin/payments", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { email, monthKey } = req.query;

    const filter = {};
    if (email) filter.email = email;
    if (monthKey) filter.monthKey = monthKey;

    const payments = await paymentsCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .toArray();

    res.send({ success: true, payments });
  } catch (error) {
    res.status(500).send({ success: false, message: "Failed to load payments", error: error.message });
  }
});


    /* =========================
       ✅ STAFF ENDPOINTS
       ========================= */


app.get("/staff/issues", verifyToken, requireStaff, async (req, res) => {
  try {
    const email = req.decoded.email;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = { "assignedTo.email": email };

const status = (req.query.status || "all").trim().toLowerCase();
if (status !== "all") {
  const normalized =
    status === "working" ? "in-progress" :
    status === "closed" ? "resolved" :
    status;

  filter.status = normalized;
}


    const priority = (req.query.priority || "all").trim().toLowerCase();
    if (priority !== "all") filter.priority = priority;

    const pipeline = [
      { $match: filter },
      {
        $addFields: {
          priorityRank: {
            $cond: [{ $eq: ["$priority", "high"] }, 1, 0],
          },
        },
      },
      { $sort: { priorityRank: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      { $project: { priorityRank: 0 } },
    ];

    const issues = await issuesCollection.aggregate(pipeline).toArray();
    const total = await issuesCollection.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    res.send({ success: true, issues, total, page, limit, totalPages });
  } catch (error) {
    console.error("Error fetching staff issues:", error);
    res.status(500).send({
      success: false,
      message: "Failed to load assigned issues",
      error: error.message,
    });
  }
});


    app.patch("/staff/issues/:id/status", verifyToken, requireStaff, async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;
        const staffEmail = req.decoded.email;

        if (!ObjectId.isValid(id)) return res.status(400).send({ success: false, message: "Invalid issue ID" });
        if (!status) return res.status(400).send({ success: false, message: "Status is required" });

        const issue = await issuesCollection.findOne({
          _id: new ObjectId(id),
          "assignedTo.email": staffEmail,
        });

        if (!issue) {
          return res.status(404).send({ success: false, message: "Issue not found or not assigned to you" });
        }

const rawStatus = String(status).trim().toLowerCase();

// staff can submit these

// ✅ normalize to keep DB consistent with your dashboards
const allowedStaffStatuses = ["in-progress", "resolved"];
if (!allowedStaffStatuses.includes(rawStatus)) {
  return res.status(400).send({ success: false, message: "Invalid status" });
}

const normalizedStatus = rawStatus;


// ✅ timeline keeps the audit meaning (closed/working) without breaking UI
const timelineItem = {
  status: normalizedStatus,                       // keep canonical for timeline filtering
  message:
    rawStatus === "working"
      ? "Work started on the issue"
      : rawStatus === "closed"
      ? "Issue closed by staff"
      : `Status changed to ${normalizedStatus}`,
  updatedBy: "Staff",
  date: new Date(),
};

const result = await issuesCollection.findOneAndUpdate(
  { _id: new ObjectId(id) },
  { $set: { status: normalizedStatus, updatedAt: new Date() }, $push: { timeline: timelineItem } },
  { returnDocument: "after" }
);

res.send({
  success: true,
  message: "Status updated",
  issue: result.value,
  normalizedStatus,         // helpful for frontend
  receivedStatus: rawStatus // helpful for frontend
});


        // res.send({ success: true, message: "Status updated", issue: result.value });
      } catch (error) {
        console.error("Error updating status:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update status",
          error: error.message,
        });
      }
    });

    // ✅ PUBLIC: Get resolved issues for homepage
app.get("/issues/resolved", async (req, res) => {
  try {
    const issues = await issuesCollection
      .find({
        status: { $regex: /resolved|closed/i }
      })
      .sort({ updatedAt: -1 })
      .limit(6)
      .toArray();

    res.send({ success: true, issues });
  } catch (error) {
    console.error("Error fetching resolved issues:", error);
    res.status(500).send({
      success: false,
      message: "Failed to load resolved issues",
      error: error.message
    });
  }
});

    /* =========================
       ✅ SETUP ADMIN (one-time)
       ========================= */
    app.post("/setup-admin", async (req, res) => {
      try {
        const { email, secret } = req.body || {};
        const ADMIN_SECRET = (process.env.ADMIN_SETUP_SECRET || "").trim();

        if (!ADMIN_SECRET) {
          return res.status(500).send({
            success: false,
            message: "ADMIN_SETUP_SECRET is missing in server .env",
          });
        }

        if ((secret || "").trim() !== ADMIN_SECRET) {
          return res.status(403).send({ success: false, message: "Invalid secret key" });
        }

        if (!email) return res.status(400).send({ success: false, message: "Email is required" });

        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).send({ success: false, message: "User not found. Please register first." });
        }

        await usersCollection.updateOne(
          { email },
          { $set: { role: "admin", isPremium: true, updatedAt: new Date() } }
        );

        res.send({ success: true, message: `✅ ${email} is now admin` });
      } catch (error) {
        console.error("Error setting up admin:", error);
        res.status(500).send({
          success: false,
          message: "Failed to setup admin",
          error: error.message,
        });
      }
    });


    // create staff 
app.post("/admin/staff", verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name, email, phone, photoURL, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).send({
        success: false,
        message: "name, email, and password are required",
      });
    }

    // 1) Create in Firebase Auth
    let fbUser;
    try {
      fbUser = await admin.auth().createUser({
        email,
        password,
        displayName: name,
        photoURL: photoURL || "",
      });
    } catch (err) {
      return res.status(400).send({
        success: false,
        message: err?.message || "Failed to create Firebase user",
      });
    }

    // 2) Save in MongoDB (⚠️ password stored for assignment visibility)
    const staffDoc = {
      email,
      name,
      phone: phone || "",
      photoURL: photoURL || "",
      role: "staff",
      isBlocked: false,
      isPremium: false,
      issueCount: 0,

      // ⚠️ assignment-only
      staffPassword: password,

      firebaseUid: fbUser.uid,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // if exists, promote/overwrite
    const existing = await usersCollection.findOne({ email });
    if (existing) {
      await usersCollection.updateOne(
        { email },
        { $set: { ...staffDoc, createdAt: existing.createdAt } }
      );

      return res.send({ success: true, message: "Staff updated (promoted existing user)" });
    }

    await usersCollection.insertOne(staffDoc);

    res.status(201).send({ success: true, message: "Staff created successfully" });
  } catch (error) {
    console.error("Error creating staff:", error);
    res.status(500).send({
      success: false,
      message: "Failed to create staff",
      error: error.message,
    });
  }
});



// update staff info mongodb and fire only 
app.patch("/admin/staff/:email", verifyToken, requireAdmin, async (req, res) => {
  try {
    const targetEmail = req.params.email;
    const { name, phone, photoURL, password, isBlocked } = req.body || {};

    const staff = await usersCollection.findOne({ email: targetEmail });
    if (!staff) return res.status(404).send({ success: false, message: "Staff not found" });

    if ((staff.role || "").toLowerCase() !== "staff") {
      return res.status(400).send({ success: false, message: "Target user is not staff" });
    }

    const $set = { updatedAt: new Date() };
    if (name !== undefined) $set.name = name;
    if (phone !== undefined) $set.phone = phone;
    if (photoURL !== undefined) $set.photoURL = photoURL;
    if (isBlocked !== undefined) $set.isBlocked = isBlocked;

    // ⚠️ assignment-only
    if (password !== undefined && password !== "") $set.staffPassword = password;

    await usersCollection.updateOne({ email: targetEmail }, { $set });

    // Sync to Firebase (name/photo/password if provided)
    try {
      const fb = await admin.auth().getUserByEmail(targetEmail);

      const fbUpdate = {};
      if (name !== undefined) fbUpdate.displayName = name;
      if (photoURL !== undefined) fbUpdate.photoURL = photoURL;
      if (password !== undefined && password !== "") fbUpdate.password = password;

      if (Object.keys(fbUpdate).length) {
        await admin.auth().updateUser(fb.uid, fbUpdate);
      }
    } catch (e) {
      // ignore sync errors for assignment stability
    }

    res.send({ success: true, message: "Staff updated" });
  } catch (error) {
    console.error("Error updating staff:", error);
    res.status(500).send({
      success: false,
      message: "Failed to update staff",
      error: error.message,
    });
  }
});



//delete staff mongo+firebase 

app.delete("/admin/staff/:email", verifyToken, requireAdmin, async (req, res) => {
  try {
    const targetEmail = req.params.email;

    const staff = await usersCollection.findOne({ email: targetEmail });
    if (!staff) return res.status(404).send({ success: false, message: "Staff not found" });

    if ((staff.role || "").toLowerCase() !== "staff") {
      return res.status(400).send({ success: false, message: "Target user is not staff" });
    }

    await usersCollection.deleteOne({ email: targetEmail });

    try {
      const fb = await admin.auth().getUserByEmail(targetEmail);
      await admin.auth().deleteUser(fb.uid);
    } catch (e) {}

    res.send({ success: true, message: "Staff deleted" });
  } catch (error) {
    console.error("Error deleting staff:", error);
    res.status(500).send({
      success: false,
      message: "Failed to delete staff",
      error: error.message,
    });
  }
});




    console.log("✅ All routes loaded successfully");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    // process.exit(1);
  }
}

run().catch(console.dir);

module.exports = app;


