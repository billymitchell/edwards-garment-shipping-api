const express = require('express');

const app = express();
app.use(express.json()); // Middleware to parse JSON request bodies

// Shipment method mapping table
const shipmentMethodMapping = {
    "GRND": "Ground",
    "RES": "Residential",
    "3DAY": "3-Day Select",
    "2DAY": "2-Day Air",
    "1DAY": "Next Day Air",
    "STD": "Standard",
    "EXP": "Express"
};

// Single route to process data
app.post('/', async (req, res) => {
    try {
        // Validate the request body
        const data = req.body;
        if (!data || typeof data.mail_attachments !== 'object') {
            console.error("Invalid input: 'mail_attachments' must be an object.");
            return res.status(400).json({
                success: false,
                message: "Invalid input: 'mail_attachments' must be an object."
            });
        }

        const attachment = data.mail_attachments;

        // Validate required fields in the attachment
        if (!attachment.tracking_number) {
            console.error("Invalid attachment: Missing 'tracking_number'.");
            return res.status(400).json({
                success: false,
                message: "Invalid attachment: Missing 'tracking_number'."
            });
        }

        // Parse carrier code and shipment method code from 'ship_via_description'
        const [carrier_code, shipment_method_code] = attachment.ship_via_description
            ? attachment.ship_via_description.split(' ')
            : [null, null];

        // Map shipment method code to a readable format
        const shipment_method = shipmentMethodMapping[shipment_method_code] || shipment_method_code;

        // Construct the payload to send to the external API
        const extractedData = {
            source_id: attachment.customer_po || null,
            tracking_number: attachment.tracking_number,
            carrier_code: carrier_code || null,
            shipment_method: shipment_method || null
        };

        console.log("Payload prepared for external API:", extractedData);

        // Send the payload to the external API
        const response = await fetch('https://orderdesk-single-order-ship-65ffd8ceba36.herokuapp.com/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(extractedData)
        });

        // Handle non-OK responses from the external API
        if (!response.ok) {
            const errorResponse = await response.text();
            console.error("Error response from external API:", errorResponse);

            let formattedError;
            try {
                formattedError = JSON.parse(errorResponse);
            } catch (parseError) {
                formattedError = { raw: errorResponse };
            }

            // Throw a detailed error object for further handling
            throw {
                success: false,
                message: "Failed to submit shipment",
                status: `${response.status} ${response.statusText}`,
                requestBody: extractedData,
                serverResponse: formattedError
            };
        }

        // Parse and return the successful response from the external API
        const responseData = await response.json();
        console.log("Response received from external API:", responseData);
        res.json({ success: true, response: responseData });

    } catch (error) {
        // Handle known errors with detailed responses
        if (error.success === false) {
            console.error("Known error occurred:", error);
            res.status(400).json(error);
        } else {
            // Handle unexpected errors
            console.error("Unexpected error occurred:", error);
            res.status(500).json({
                success: false,
                message: "An unexpected error occurred",
                error: error.message || "Unknown error"
            });
        }
    }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});