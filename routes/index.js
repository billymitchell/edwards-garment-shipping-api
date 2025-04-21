function setRoutes(app) {
    const IndexController = require('../controllers/index');
    const indexController = new IndexController();

    // Existing GET route
    app.get('/', (req, res) => indexController.getIndex(req, res));

    // POST route for processing data
    app.post('/process', async (req, res) => {
        try {
            const data = req.body; // Assuming the data is sent in the request body
            const result = await indexController.processData(data); // Call processData
            res.json(result); // Send the result back to the client
        } catch (error) {
            res.status(400).json({ success: false, error: error.message }); // Handle errors
        }
    });
}

module.exports = setRoutes;