const express = require('express');
const app = express();
const setRoutes = require('./routes/index');

// Middleware to parse JSON
app.use(express.json());

// Set up routes
setRoutes(app);

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});