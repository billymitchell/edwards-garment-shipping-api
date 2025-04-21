class IndexController {
    getIndex(req, res) {
        res.send('Welcome to the Express Server!');
    }

    async processData(data) {
        try {
            // Validate input data
            if (!data || !Array.isArray(data.mail_attachments)) {
                throw new Error("Invalid input: 'mail_attachments' must be an array.");
            }

            // Use a Set to track unique tracking numbers
            const seenTrackingNumbers = new Set();

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

            // Extract and process mail_attachments, removing duplicates
            const extractedData = data.mail_attachments
                .filter(attachment => {
                    if (!attachment.tracking_number) {
                        throw new Error("Invalid attachment: Missing 'tracking_number'.");
                    }
                    if (seenTrackingNumbers.has(attachment.tracking_number)) {
                        return false; // Skip duplicates
                    }
                    seenTrackingNumbers.add(attachment.tracking_number);
                    return true;
                })
                .map(attachment => {
                    const [carrier_code, shipment_method_code] = attachment.ship_via_description
                        ? attachment.ship_via_description.split(' ')
                        : [null, null]; // Handle missing or invalid ship_via_description
                    const shipment_method = shipmentMethodMapping[shipment_method_code] || shipment_method_code; // Map to full name or fallback

                    return {
                        order_id: attachment.customer_po || null, // Use customer_po as order_id
                        tracking_number: attachment.tracking_number,
                        carrier_code: carrier_code || null, // Handle cases where split might fail
                        shipment_method: shipment_method || null // Handle cases where mapping might fail
                    };
                });

            // Submit each extracted shipment to the API
            const responses = [];
            for (const shipment of extractedData) {
                const response = await fetch('https://orderdesk-single-order-ship-65ffd8ceba36.herokuapp.com/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(shipment)
                });

                if (!response.ok) {
                    throw new Error(`Failed to submit shipment: ${response.statusText}`);
                }

                const responseData = await response.json();
                responses.push(responseData);
            }

            return { success: true, responses };
        } catch (error) {
            // Handle errors and return them
            throw new Error(`Error processing data: ${error.message}`);
        }
    }
}

module.exports = IndexController;