// server.js - Complete with MongoDB Atlas connection
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ==================== MONGODB ATLAS CONNECTION ====================
// REPLACE YOUR_CLUSTER with your actual cluster name from Atlas
// The cluster name is usually like: cluster0.abcde.mongodb.net
const MONGODB_URI = "mongodb+srv://maikabdul47_db_user:Maikabdul2345@cluster0.xxxxx.mongodb.net/votesure?retryWrites=true&w=majority";

// NOTE: You need to replace "cluster0.xxxxx" with your actual cluster address!
// Find it in MongoDB Atlas: Clusters → Connect → Connect your application

// For Render deployment (uncomment and use this instead):
// const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://maikabdul47_db_user:Maikabdul2345@YOUR_CLUSTER.mongodb.net/votesure";

// Environment variables
const PORT = process.env.PORT || 3000;
const AFRICA_TALKING_API_KEY = "atsk_4b55a84b200178ba1062df465c624be9663b757b9c2be856b1f35a9670aac32a43f6b7ef";
const AFRICA_TALKING_USERNAME = "ARZIA";

// Connect to MongoDB Atlas
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 10000,
})
.then(() => {
    console.log('✅ MongoDB Atlas connected successfully!');
    console.log('📊 Database: votesure');
})
.catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    console.log('\n⚠️ To fix this:');
    console.log('1. Go to MongoDB Atlas → Network Access');
    console.log('2. Add IP address 0.0.0.0/0 (for testing)');
    console.log('3. Or add your current IP address');
    console.log('4. Make sure username and password are correct\n');
});

// ==================== SCHEMAS ====================
const verificationCodeSchema = new mongoose.Schema({
    voterId: { type: String, required: true, unique: true },
    phone: { type: String, required: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
});
const VerificationCode = mongoose.model('VerificationCode', verificationCodeSchema);

const voterActivitySchema = new mongoose.Schema({
    voterId: { type: String, required: true, unique: true },
    hasActivity: { type: Boolean, default: true },
    lastChecked: { type: Date, default: Date.now }
});
const VoterActivity = mongoose.model('VoterActivity', voterActivitySchema);

const reportSchema = new mongoose.Schema({
    voterId: { type: String, required: true },
    phone: { type: String, required: true },
    issueType: { type: String, required: true },
    description: { type: String },
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
const Report = mongoose.model('Report', reportSchema);

const verificationLogSchema = new mongoose.Schema({
    voterId: String,
    success: Boolean,
    timestamp: { type: Date, default: Date.now }
});
const VerificationLog = mongoose.model('VerificationLog', verificationLogSchema);

// ==================== HELPER FUNCTIONS ====================
function generateRandomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function formatPhoneNumber(phone) {
    let formatted = phone.trim();
    if (!formatted.startsWith('+')) {
        if (formatted.startsWith('0')) {
            formatted = '+234' + formatted.substring(1);
        } else if (formatted.startsWith('234')) {
            formatted = '+' + formatted;
        } else {
            formatted = '+234' + formatted;
        }
    }
    return formatted;
}

// ==================== SMS SENDING FUNCTION ====================
async function sendSMS(phoneNumber, message, codeValue) {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    
    try {
        const response = await axios.post('https://api.sandbox.africastalking.com/version1/messaging', 
            new URLSearchParams({
                username: AFRICA_TALKING_USERNAME,
                to: formattedPhone,
                message: message,
                from: 'VoteSure'
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'apiKey': AFRICA_TALKING_API_KEY,
                    'Accept': 'application/json'
                }
            }
        );
        
        console.log("SMS sent successfully");
        return { success: true };
    } catch (error) {
        console.error("SMS Error:", error.message);
        // Mock mode - code appears in console
        console.log(`📱 [MOCK SMS] To: ${formattedPhone} | Code: ${codeValue}`);
        return { success: true, mock: true };
    }
}

// ==================== RATE LIMITING ====================
const smsLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 3,
    message: { error: "Too many requests. Please wait 5 minutes." }
});

// ==================== USSD HANDLER ====================
app.post('/ussd', async (req, res) => {
    const { sessionId, serviceCode, phoneNumber, text } = req.body;
    const userInput = text ? text.split('*') : [];
    const level = userInput.length;
    let response = "";
    
    if (level === 0 || (level === 1 && !text)) {
        response = `CON Welcome to VoteSure - Secure Voting System\n`;
        response += `1. Verify Vote\n`;
        response += `2. Check Voter Activity\n`;
        response += `3. Report Issue\n`;
        response += `0. Exit`;
    }
    else if (userInput[0] === '1') {
        if (level === 1) {
            response = `CON Enter your Voter ID (VIN):`;
        } else if (level === 2) {
            response = `CON Enter your 5-character Verification Code:`;
        } else if (level === 3) {
            const voterId = userInput[1];
            const code = userInput[2].toUpperCase();
            
            const record = await VerificationCode.findOne({ voterId });
            
            if (record && record.code === code && new Date() < record.expiresAt) {
                await VoterActivity.findOneAndUpdate(
                    { voterId },
                    { hasActivity: true, lastChecked: new Date() },
                    { upsert: true }
                );
                await VerificationCode.deleteOne({ voterId });
                await VerificationLog.create({ voterId, success: true });
                response = `END ✅ Your vote was successfully recorded! Thank you for verifying.`;
            } else {
                await VerificationLog.create({ voterId, success: false });
                response = `END ❌ Invalid or expired verification code. Please request a new code.`;
            }
        }
    }
    else if (userInput[0] === '2') {
        if (level === 1) {
            response = `CON Enter your Voter ID (VIN) to check activity:`;
        } else if (level === 2) {
            const voterId = userInput[1];
            const activity = await VoterActivity.findOne({ voterId });
            
            if (activity && activity.hasActivity) {
                response = `END ⚠️ Voting activity detected for Voter ID ${voterId}. Please verify your vote.`;
            } else {
                response = `END ✅ No voting activity found for Voter ID ${voterId}. Your vote is secure.`;
            }
        }
    }
    else if (userInput[0] === '3') {
        if (level === 1) {
            response = `CON Enter your Voter ID (VIN):`;
        } else if (level === 2) {
            response = `CON Select issue type:\n1. Unauthorized voting\n2. Verification issue`;
        } else if (level === 3) {
            const voterId = userInput[1];
            const issueOption = userInput[2];
            const issueType = issueOption === '1' ? 'Unauthorized voting' : 'Verification issue';
            
            await Report.create({
                voterId,
                phone: phoneNumber,
                issueType,
                description: `Reported via USSD`,
                status: 'pending'
            });
            
            response = `END ✅ Your report has been submitted successfully. Reference ID: ${Date.now().toString().slice(-8)}.`;
        }
    }
    else if (userInput[0] === '0') {
        response = `END Thank you for using VoteSure. Goodbye!`;
    }
    else {
        response = `END Invalid option. Please try again.`;
    }
    
    res.set('Content-Type', 'text/plain');
    res.send(response);
});

// ==================== API ENDPOINTS ====================
app.post('/api/request-code', smsLimiter, async (req, res) => {
    const { voterId, phone } = req.body;
    
    if (!voterId || !phone) {
        return res.status(400).json({ error: "Voter ID and phone number required" });
    }
    
    const code = generateRandomCode();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
    
    await VerificationCode.findOneAndUpdate(
        { voterId },
        { phone, code, expiresAt },
        { upsert: true }
    );
    
    const message = `VoteSure: Your verification code is ${code}. Valid for 3 minutes.`;
    await sendSMS(phone, message, code);
    
    res.json({
        success: true,
        message: "Code sent successfully"
    });
});

app.post('/api/verify', async (req, res) => {
    const { voterId, code } = req.body;
    
    if (!voterId || !code) {
        return res.status(400).json({ error: "Voter ID and code required" });
    }
    
    const record = await VerificationCode.findOne({ voterId });
    
    if (record && record.code === code.toUpperCase() && new Date() < record.expiresAt) {
        await VerificationCode.deleteOne({ voterId });
        await VoterActivity.findOneAndUpdate(
            { voterId },
            { hasActivity: true, lastChecked: new Date() },
            { upsert: true }
        );
        await VerificationLog.create({ voterId, success: true });
        res.json({ success: true, message: "Your vote was successfully recorded" });
    } else {
        await VerificationLog.create({ voterId, success: false });
        res.json({ success: false, message: "Invalid or expired code" });
    }
});

app.post('/api/check-activity', async (req, res) => {
    const { voterId } = req.body;
    
    if (!voterId) {
        return res.status(400).json({ error: "Voter ID required" });
    }
    
    const activity = await VoterActivity.findOne({ voterId });
    
    if (activity && activity.hasActivity) {
        res.json({ hasActivity: true, message: "Voting activity detected – please verify" });
    } else {
        res.json({ hasActivity: false, message: "No voting activity found" });
    }
});

app.post('/api/report', async (req, res) => {
    const { voterId, phone, issueType, description } = req.body;
    
    if (!voterId || !phone || !issueType) {
        return res.status(400).json({ error: "Voter ID, phone, and issue type required" });
    }
    
    const report = await Report.create({
        voterId,
        phone,
        issueType,
        description: description || "",
        status: 'pending'
    });
    
    const confirmMsg = `VoteSure: Your report (ID: ${report._id.toString().slice(-8)}) has been received.`;
    await sendSMS(phone, confirmMsg, "report");
    
    res.json({
        success: true,
        message: "Your report has been received and is under review",
        reportId: report._id
    });
});

app.get('/api/admin/stats', async (req, res) => {
    const totalVerifications = await VerificationLog.countDocuments({ success: true });
    const totalReports = await Report.countDocuments();
    const flaggedVoters = await VoterActivity.countDocuments();
    const pendingReports = await Report.countDocuments({ status: 'pending' });
    
    res.json({ totalVerifications, totalReports, flaggedVoters, pendingReports });
});

app.get('/api/admin/reports', async (req, res) => {
    const reports = await Report.find().sort({ createdAt: -1 }).limit(50);
    res.json(reports);
});

// Serve frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`\n🚀 VoteSure Server running on http://localhost:${PORT}`);
    console.log(`📱 SMS API: Ready (Africa's Talking)`);
    console.log(`📞 USSD Endpoint: POST /ussd`);
    console.log(`🗄️  MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Waiting for connection...'}\n`);
});