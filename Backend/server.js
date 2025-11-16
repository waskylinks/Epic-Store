import app from './app.js';
import dotenv from 'dotenv';
import connectDB from './Database/database.js';


// Connect to the database
connectDB();



dotenv.config('config/config.env');
const PORT = process.env.PORT || 8000;

const server = app.listen(PORT, () => {
    console.log(`Server is listening on PORT ${PORT}`)
})

process.on("unhandledRejection", (err) => {
    console.log(`Error: ${err.message}`);
    console.log("Shutting down the server due to Unhandled Promise Rejection");

    server.close(() => {
        process.exit(1);
    })
});
