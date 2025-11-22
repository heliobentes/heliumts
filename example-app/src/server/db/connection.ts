import mongoose from "mongoose";

let isConnected = false;

export async function connectToDatabase() {
    if (isConnected) {
        return;
    }

    const MONGODB_URI = process.env.MONGODB_URI;

    if (!MONGODB_URI) {
        throw new Error("MONGODB_URI environment variable is not set");
    }

    try {
        await mongoose.connect(MONGODB_URI);
        isConnected = true;
        console.log("✅ Connected to MongoDB");
    } catch (error) {
        console.error("❌ MongoDB connection error:", error);
        throw error;
    }
}

// Handle connection events
mongoose.connection.on("disconnected", () => {
    isConnected = false;
    console.log("MongoDB disconnected");
});

mongoose.connection.on("error", (error) => {
    console.error("MongoDB connection error:", error);
    isConnected = false;
});
