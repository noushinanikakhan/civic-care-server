const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// ✅ Firebase Admin (server only)
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey-civiccare.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const port = process.env.PORT || 3000;

/* =========================
   ✅ MIDDLEWARE
   ========================= */
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/* =========================
   ✅ VERIFY TOKEN (Firebase ID Token)
   ========================= */
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).send({ message: "Unauthorized (no token)" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(token);

    req.decoded = decoded;
    next();
  } catch (err) {
    console.error("Token verification error:", err.message);
    return res.status(401).send({ message: "Unauthorized (invalid token)" });
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
    await client.connect();
    console.log("✅ Connected to MongoDB!");

    const db = client.db("civic_care_db");
    const usersCollection = db.collection("users");
    const issuesCollection = db.collection("issues");

    // ✅ Create indexes if they don't exist
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    await issuesCollection.createIndex({ createdAt: -1 });
    await issuesCollection.createIndex({ category: 1 });
    await issuesCollection.createIndex({ status: 1 });

    console.log("✅ Database indexes created");

    /* =========================
       ✅ ROOT ENDPOINT
       ========================= */
    app.get("/", (req, res) => {
      res.send("🚀 CivicCare Server is running");
    });

    /* =========================
       ✅ HEALTH CHECK
       ========================= */
    app.get("/health", async (req, res) => {
      try {
        // Check MongoDB connection
        await client.db("admin").command({ ping: 1 });
        
        // Check collections exist
        const usersCount = await usersCollection.countDocuments();
        const issuesCount = await issuesCollection.countDocuments();
        
        res.send({
          status: "healthy",
          database: "connected",
          collections: {
            users: usersCount,
            issues: issuesCount
          },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).send({
          status: "unhealthy",
          error: error.message
        });
      }
    });

    /* =========================
       ✅ USERS ENDPOINTS
       ========================= */

    // ✅ CREATE USER (after Firebase auth)
    app.post("/users", async (req, res) => {
      try {
        const { email, name, photoURL } = req.body;

        if (!email) {
          return res.status(400).send({ 
            success: false, 
            message: "Email is required" 
          });
        }

        // Check if user already exists
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          return res.send({ 
            success: true, 
            message: "User already exists",
            user: existingUser
          });
        }

        // Create new user document
        const userDoc = {
          email,
          name: name || email.split('@')[0],
          photoURL: photoURL || "",
          role: "citizen", // Default role
          isPremium: false,
          isBlocked: false,
          issueCount: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const result = await usersCollection.insertOne(userDoc);
        
        res.status(201).send({ 
          success: true, 
          message: "User created successfully",
          userId: result.insertedId,
          user: userDoc
        });
      } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to create user",
          error: error.message 
        });
      }
    });

    // ✅ GET USER PROFILE (secured)
    app.get("/users/profile/:email", verifyToken, async (req, res) => {
      try {
        const requestedEmail = req.params.email;
        const tokenEmail = req.decoded.email;

        // Allow user to view own profile OR admin to view any profile
        const requester = await usersCollection.findOne({ email: tokenEmail });
        
        if (!requester) {
          return res.status(404).send({ 
            success: false, 
            message: "Requester not found" 
          });
        }

        // Check permission
        if (requester.email !== requestedEmail && requester.role !== "admin") {
          return res.status(403).send({ 
            success: false, 
            message: "Forbidden: Cannot access other user's profile" 
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
              role: 1,
              isPremium: 1,
              isBlocked: 1,
              issueCount: 1,
              createdAt: 1
            }
          }
        );

        if (!user) {
          return res.status(404).send({ 
            success: false, 
            message: "User not found" 
          });
        }

        res.send({ 
          success: true, 
          user 
        });
      } catch (error) {
        console.error("Error fetching profile:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to load profile",
          error: error.message 
        });
      }
    });

    // ✅ GET ALL USERS (admin only - for admin dashboard)
    app.get("/users", verifyToken, async (req, res) => {
      try {
        const tokenEmail = req.decoded.email;
        const requester = await usersCollection.findOne({ email: tokenEmail });

        if (!requester || requester.role !== "admin") {
          return res.status(403).send({ 
            success: false, 
            message: "Admin access required" 
          });
        }

        const users = await usersCollection
          .find({}, {
            projection: {
              password: 0 // Exclude sensitive fields
            }
          })
          .sort({ createdAt: -1 })
          .toArray();

        res.send({ 
          success: true, 
          users,
          count: users.length
        });
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to load users",
          error: error.message 
        });
      }
    });

    // ✅ UPDATE USER ROLE (admin only)
    app.patch("/users/:email/role", verifyToken, async (req, res) => {
      try {
        const tokenEmail = req.decoded.email;
        const targetEmail = req.params.email;
        const { role } = req.body;

        // Check if requester is admin
        const requester = await usersCollection.findOne({ email: tokenEmail });
        if (!requester || requester.role !== "admin") {
          return res.status(403).send({ 
            success: false, 
            message: "Admin access required" 
          });
        }

        // Validate role
        const allowedRoles = ["citizen", "staff", "admin"];
        if (!role || !allowedRoles.includes(role)) {
          return res.status(400).send({ 
            success: false, 
            message: "Invalid role. Allowed: citizen, staff, admin" 
          });
        }

        // Prevent self-demotion (admin changing their own role)
        if (targetEmail === tokenEmail && role !== "admin") {
          return res.status(400).send({ 
            success: false, 
            message: "Cannot change your own admin role" 
          });
        }

        const result = await usersCollection.updateOne(
          { email: targetEmail },
          { 
            $set: { 
              role, 
              updatedAt: new Date() 
            } 
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ 
            success: false, 
            message: "User not found" 
          });
        }

        res.send({ 
          success: true, 
          message: `User role updated to ${role}`,
          modifiedCount: result.modifiedCount
        });
      } catch (error) {
        console.error("Error updating role:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to update role",
          error: error.message 
        });
      }
    });

    // ✅ TOGGLE USER BLOCK STATUS (admin only)
    app.patch("/users/:email/toggle-block", verifyToken, async (req, res) => {
      try {
        const tokenEmail = req.decoded.email;
        const targetEmail = req.params.email;

        // Check if requester is admin
        const requester = await usersCollection.findOne({ email: tokenEmail });
        if (!requester || requester.role !== "admin") {
          return res.status(403).send({ 
            success: false, 
            message: "Admin access required" 
          });
        }

        // Get target user
        const targetUser = await usersCollection.findOne({ email: targetEmail });
        if (!targetUser) {
          return res.status(404).send({ 
            success: false, 
            message: "User not found" 
          });
        }

        // Prevent blocking admins
        if (targetUser.role === "admin") {
          return res.status(400).send({ 
            success: false, 
            message: "Cannot block admin users" 
          });
        }

        const newBlockStatus = !targetUser.isBlocked;
        
        await usersCollection.updateOne(
          { email: targetEmail },
          { 
            $set: { 
              isBlocked: newBlockStatus,
              updatedAt: new Date() 
            } 
          }
        );

        res.send({ 
          success: true, 
          message: `User ${newBlockStatus ? "blocked" : "unblocked"} successfully`,
          isBlocked: newBlockStatus
        });
      } catch (error) {
        console.error("Error toggling block status:", error);
        res.status(500).send({ 
          success: false, 
          message: "Failed to update user",
          error: error.message 
        });
      }
    });

    /* =========================
       ✅ ISSUES ENDPOINTS
       ========================= */

    // ✅ GET ALL ISSUES (public with filters)
    app.get("/issues", async (req, res) => {
      try {
        console.log("📝 GET /issues called with query:", req.query);
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 6;
        const skip = (page - 1) * limit;

        // Query parameters
        const search = (req.query.search || "").trim();
        const category = (req.query.category || "all").trim();
        const status = (req.query.status || "all").trim();
        const priority = (req.query.priority || "all").trim();
        const reportedBy = (req.query.reportedBy || "").trim();

        // Build filter
        const filter = {};
        
        // Category filter
        if (category !== "all") {
          filter.category = category;
        }
        
        // Status filter
        if (status !== "all") {
          filter.status = status;
        }
        
        // Priority filter
        if (priority !== "all") {
          filter.priority = priority;
        }
        
        // Reported by filter (for "My Issues" page)
        if (reportedBy) {
          filter.reportedBy = reportedBy;
        }
        
        // Search filter
        if (search) {
          const regex = new RegExp(search, "i");
          filter.$or = [
            { title: regex },
            { category: regex },
            { location: regex },
            { description: regex }
          ];
        }

        console.log("🔍 MongoDB filter:", JSON.stringify(filter, null, 2));

        // Count total matching documents
        const total = await issuesCollection.countDocuments(filter);
        
        // Get paginated results
        const issues = await issuesCollection
          .find(filter)
          .sort({ createdAt: -1 }) // Newest first
          .skip(skip)
          .limit(limit)
          .toArray();

        console.log(`✅ Found ${issues.length} issues out of ${total}`);

        // Calculate pagination info
        const totalPages = Math.ceil(total / limit);

        res.send({
          success: true,
          total,
          totalPages,
          page,
          limit,
          issues,
          hasMore: page < totalPages
        });
      } catch (error) {
        console.error("❌ Error in /issues route:", error);
        res.status(500).send({
          success: false,
          message: "Failed to load issues",
          error: error.message
        });
      }
    });

    // ✅ GET SINGLE ISSUE DETAILS
    app.get("/issues/:id", async (req, res) => {
      try {
        const { id } = req.params;

        // Validate ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            success: false,
            message: "Invalid issue ID format"
          });
        }

        const issue = await issuesCollection.findOne({
          _id: new ObjectId(id)
        });

        if (!issue) {
          return res.status(404).send({
            success: false,
            message: "Issue not found"
          });
        }

        res.send({
          success: true,
          issue
        });
      } catch (error) {
        console.error("Error fetching issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to load issue details",
          error: error.message
        });
      }
    });

    // ✅ CREATE NEW ISSUE (secured)
    app.post("/issues", verifyToken, async (req, res) => {
      try {
        const userEmail = req.decoded.email;
        
        // Check if user exists and is not blocked
        const user = await usersCollection.findOne({ email: userEmail });
        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found. Please login again."
          });
        }

        if (user.isBlocked) {
          return res.status(403).send({
            success: false,
            message: "Your account is blocked. Cannot submit issues."
          });
        }

        // Check issue limit for non-premium users
        if (!user.isPremium) {
          const userIssueCount = await issuesCollection.countDocuments({
            reportedBy: userEmail
          });
          
          if (userIssueCount >= 3) {
            return res.status(403).send({
              success: false,
              message: "Free users can only submit 3 issues. Upgrade to premium for unlimited submissions."
            });
          }
        }

        const issueData = {
          ...req.body,
          reportedBy: userEmail,
          status: "pending", // Default status
          priority: req.body.priority || "normal", // Default priority
          upvoteCount: 0,
          upvotedBy: [],
          commentCount: 0,
          isBoosted: false,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        // Validate required fields
        const requiredFields = ["title", "category", "location", "description"];
        for (const field of requiredFields) {
          if (!issueData[field]?.trim()) {
            return res.status(400).send({
              success: false,
              message: `Field "${field}" is required`
            });
          }
        }

        // Insert issue
        const result = await issuesCollection.insertOne(issueData);
        
        // Update user's issue count
        await usersCollection.updateOne(
          { email: userEmail },
          { $inc: { issueCount: 1 } }
        );

        res.status(201).send({
          success: true,
          message: "Issue reported successfully",
          issueId: result.insertedId,
          issue: issueData
        });
      } catch (error) {
        console.error("Error creating issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to create issue",
          error: error.message
        });
      }
    });

    // ✅ UPDATE ISSUE (secured - only reporter or admin)
    app.patch("/issues/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const userEmail = req.decoded.email;
        const updateData = req.body;

        // Validate ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            success: false,
            message: "Invalid issue ID format"
          });
        }

        // Find the issue
        const issue = await issuesCollection.findOne({
          _id: new ObjectId(id)
        });

        if (!issue) {
          return res.status(404).send({
            success: false,
            message: "Issue not found"
          });
        }

        // Check permissions
        const user = await usersCollection.findOne({ email: userEmail });
        const isAdmin = user?.role === "admin";
        const isReporter = issue.reportedBy === userEmail;

        if (!isAdmin && !isReporter) {
          return res.status(403).send({
            success: false,
            message: "You can only update your own issues"
          });
        }

        // Define allowed fields to update
        const allowedFields = [
          "title", 
          "category", 
          "location", 
          "description", 
          "priority",
          "image",
          "status" // Only admin can update status
        ];

        const $set = {};
        for (const field of allowedFields) {
          if (updateData[field] !== undefined) {
            // Only admin can update status field
            if (field === "status" && !isAdmin) {
              continue;
            }
            $set[field] = updateData[field];
          }
        }

        if (Object.keys($set).length === 0) {
          return res.status(400).send({
            success: false,
            message: "No valid fields to update"
          });
        }

        $set.updatedAt = new Date();

        const result = await issuesCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set },
          { returnDocument: "after" }
        );

        res.send({
          success: true,
          message: "Issue updated successfully",
          issue: result.value
        });
      } catch (error) {
        console.error("Error updating issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to update issue",
          error: error.message
        });
      }
    });

    // ✅ DELETE ISSUE (secured - only reporter or admin)
    app.delete("/issues/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const userEmail = req.decoded.email;

        // Validate ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            success: false,
            message: "Invalid issue ID format"
          });
        }

        // Find the issue
        const issue = await issuesCollection.findOne({
          _id: new ObjectId(id)
        });

        if (!issue) {
          return res.status(404).send({
            success: false,
            message: "Issue not found"
          });
        }

        // Check permissions
        const user = await usersCollection.findOne({ email: userEmail });
        const isAdmin = user?.role === "admin";
        const isReporter = issue.reportedBy === userEmail;

        if (!isAdmin && !isReporter) {
          return res.status(403).send({
            success: false,
            message: "You can only delete your own issues"
          });
        }

        // Delete the issue
        const result = await issuesCollection.deleteOne({
          _id: new ObjectId(id)
        });

        if (result.deletedCount === 0) {
          return res.status(404).send({
            success: false,
            message: "Issue not found or already deleted"
          });
        }

        // Update user's issue count
        await usersCollection.updateOne(
          { email: issue.reportedBy },
          { $inc: { issueCount: -1 } }
        );

        res.send({
          success: true,
          message: "Issue deleted successfully",
          deletedCount: result.deletedCount
        });
      } catch (error) {
        console.error("Error deleting issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to delete issue",
          error: error.message
        });
      }
    });

    // ✅ UPVOTE ISSUE
    app.patch("/issues/:id/upvote", async (req, res) => {
      try {
        const { id } = req.params;
        const { userEmail } = req.body;

        if (!userEmail) {
          return res.status(401).send({
            success: false,
            message: "Login required to upvote"
          });
        }

        // Validate ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({
            success: false,
            message: "Invalid issue ID format"
          });
        }

        // Find the issue
        const issue = await issuesCollection.findOne({
          _id: new ObjectId(id)
        });

        if (!issue) {
          return res.status(404).send({
            success: false,
            message: "Issue not found"
          });
        }

        // Check if user is blocked
        const user = await usersCollection.findOne({ email: userEmail });
        if (user?.isBlocked) {
          return res.status(403).send({
            success: false,
            message: "Your account is blocked. Cannot upvote."
          });
        }

        // Cannot upvote own issue
        if (issue.reportedBy === userEmail) {
          return res.status(400).send({
            success: false,
            message: "You cannot upvote your own issue"
          });
        }

        // Check if already upvoted
        if (issue.upvotedBy?.includes(userEmail)) {
          return res.status(400).send({
            success: false,
            message: "You already upvoted this issue"
          });
        }

        // Add upvote
        const result = await issuesCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $inc: { upvoteCount: 1 },
            $push: { upvotedBy: userEmail },
            $set: { updatedAt: new Date() }
          }
        );

        res.send({
          success: true,
          message: "Upvoted successfully",
          upvoteCount: issue.upvoteCount + 1,
          modifiedCount: result.modifiedCount
        });
      } catch (error) {
        console.error("Error upvoting issue:", error);
        res.status(500).send({
          success: false,
          message: "Failed to upvote issue",
          error: error.message
        });
      }
    });

    /* =========================
       ✅ ADMIN STATS ENDPOINTS
       ========================= */

    // ✅ GET DASHBOARD STATS (admin only)
    app.get("/admin/stats", verifyToken, async (req, res) => {
      try {
        const tokenEmail = req.decoded.email;
        const requester = await usersCollection.findOne({ email: tokenEmail });

        if (!requester || requester.role !== "admin") {
          return res.status(403).send({
            success: false,
            message: "Admin access required"
          });
        }

        // Get counts
        const totalUsers = await usersCollection.countDocuments();
        const totalIssues = await issuesCollection.countDocuments();
        const pendingIssues = await issuesCollection.countDocuments({ status: "pending" });
        const resolvedIssues = await issuesCollection.countDocuments({ status: "resolved" });
        const inProgressIssues = await issuesCollection.countDocuments({ status: "in-progress" });

        // Get recent issues
        const recentIssues = await issuesCollection
          .find()
          .sort({ createdAt: -1 })
          .limit(10)
          .toArray();

        // Get user distribution by role
        const citizenCount = await usersCollection.countDocuments({ role: "citizen" });
        const staffCount = await usersCollection.countDocuments({ role: "staff" });
        const adminCount = await usersCollection.countDocuments({ role: "admin" });

        res.send({
          success: true,
          stats: {
            users: {
              total: totalUsers,
              citizen: citizenCount,
              staff: staffCount,
              admin: adminCount,
              blocked: await usersCollection.countDocuments({ isBlocked: true }),
              premium: await usersCollection.countDocuments({ isPremium: true })
            },
            issues: {
              total: totalIssues,
              pending: pendingIssues,
              resolved: resolvedIssues,
              inProgress: inProgressIssues,
              highPriority: await issuesCollection.countDocuments({ priority: "high" })
            }
          },
          recentIssues
        });
      } catch (error) {
        console.error("Error fetching admin stats:", error);
        res.status(500).send({
          success: false,
          message: "Failed to load admin stats",
          error: error.message
        });
      }
    });

    /* =========================
       ✅ SETUP ADMIN (One-time use)
       ========================= */
    app.post("/setup-admin", async (req, res) => {
      try {
        const { email, secret } = req.body;
        
        // Secret key for security (change this in production)
        const ADMIN_SECRET = "123456";
        
        if (secret !== ADMIN_SECRET) {
          return res.status(403).send({
            success: false,
            message: "Invalid secret key"
          });
        }

        if (!email) {
          return res.status(400).send({
            success: false,
            message: "Email is required"
          });
        }

        // Check if user exists
        const user = await usersCollection.findOne({ email });
        
        if (!user) {
          return res.status(404).send({
            success: false,
            message: "User not found. Please register first."
          });
        }

        // Update to admin
        await usersCollection.updateOne(
          { email },
          {
            $set: {
              role: "admin",
              isPremium: true,
              updatedAt: new Date()
            }
          }
        );

        res.send({
          success: true,
          message: `✅ ${email} is now an admin with premium access`
        });
      } catch (error) {
        console.error("Error setting up admin:", error);
        res.status(500).send({
          success: false,
          message: "Failed to setup admin",
          error: error.message
        });
      }
    });

    console.log("✅ All routes loaded successfully");

  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    process.exit(1);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🌐 Health check: http://localhost:${port}/health`);
  console.log(`📊 Admin setup: POST http://localhost:${port}/setup-admin`);
});