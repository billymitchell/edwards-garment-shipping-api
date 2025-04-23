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
app.post('/process', async (req, res) => {
    try {
        const data = req.body;

        // Validate input data
        if (!data || typeof data.mail_attachments !== 'object') {
            throw new Error("Invalid input: 'mail_attachments' must be an object.");
        }

        const attachment = data.mail_attachments;

        if (!attachment.tracking_number) {
            throw new Error("Invalid attachment: Missing 'tracking_number'.");
        }

        const [carrier_code, shipment_method_code] = attachment.ship_via_description
            ? attachment.ship_via_description.split(' ')
            : [null, null]; // Handle missing or invalid ship_via_description

        const shipment_method = shipmentMethodMapping[shipment_method_code] || shipment_method_code; // Map to full name or fallback

        const extractedData = {
            source_id: attachment.customer_po || null, // Use customer_po as source_id
            tracking_number: attachment.tracking_number,
            carrier_code: carrier_code || null, // Handle cases where split might fail
            shipment_method: shipment_method || null // Handle cases where mapping might fail
        };

        // Submit the extracted shipment to the API
        const response = await fetch('https://orderdesk-single-order-ship-65ffd8ceba36.herokuapp.com/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(extractedData)
        });

        if (!response.ok) {
            const errorResponse = await response.text(); // Read the response body
            let formattedError;

            // Try to parse the response body as JSON
            try {
                formattedError = JSON.parse(errorResponse); // Parse as JSON
            } catch (parseError) {
                // If parsing fails, keep the raw response as a string
                formattedError = { raw: errorResponse };
            }

            throw {
                success: false,
                message: `Failed to submit shipment`,
                status: `${response.status} ${response.statusText}`,
                requestBody: extractedData,
                serverResponse: formattedError // Include as an object
            };
        }

        const responseData = await response.json();

        res.json({ success: true, response: responseData });
    } catch (error) {
        if (error.success === false) {
            // Return the structured error object
            res.status(400).json(error);
        } else {
            // Handle unexpected errors
            res.status(500).json({
                success: false,
                message: "An unexpected error occurred",
                error: error.message
            });
        }
    }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});