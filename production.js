// Dummy input data for processing shipments

// const inputData = {
//     mailparser: ``,
//     API_KEY_8636: "",
//     API_KEY_43379: "",
//     API_KEY_9369: "",
// };

// Parse the mailparser JSON before using it; converts the mailparser payload from string to an object.
const parsedMail = JSON.parse(inputData.mailparser);

/**
 * Constructs a mapping between store IDs and their API configuration.
 * @param {object} keys - Object containing API keys for different stores.
 * @returns {object} Mapping of store IDs to store information.
 */
function getStoreMapping({ API_KEY_8636, API_KEY_43379, API_KEY_9369 }) {
    return {
        // Store with ID 8636 and its configuration
        8636: {
            url: "https://tsastore.mybrightsites.com/",
            apiKey: API_KEY_8636,
            skuPrefix: "TS",
        },
        // Store with ID 43379 and its configuration
        43379: {
            url: "https://fbla.mybrightsites.com/",
            apiKey: API_KEY_43379,
            skuPrefix: "BL",
        },
        // Store with ID 9369 and its configuration
        9369: {
            url: "https://fccla.mybrightsites.com/",
            apiKey: API_KEY_9369,
            skuPrefix: "FC",
        },
    };
}

/**
 * Returns a mapping for converting shipping method descriptions to standardized names.
 * @returns {object} Mapping of shipping method descriptions.
 */
function getShippingMethodsMapping() {
    return {
        "UPS RES": "UPS Ground",
        "UPS GRND": "UPS Ground",
        "FedEx GRND": "FedEx Ground",
        "UPS 3DAY": "UPS 3 Day Select",
    };
}

/**
 * Generates possible SKU variants from a given SKU.
 * This handles variations in spacing or dashes.
 * @param {string} sku - The SKU to generate variants for.
 * @returns {Array} Array of SKU variant strings.
 */
function getSkuVariants(sku) {
    const parts = sku.trim().split(/[\s-]+/);
    const variants = new Set();
    function generate(index, current) {
        if (index === parts.length - 1) {
            variants.add(current + parts[index]);
            return;
        }
        const separators = ["", " ", "-"];
        for (const sep of separators) {
            generate(index + 1, current + parts[index] + sep);
        }
    }
    if (parts.length) {
        generate(0, "");
    }
    // Always include the trimmed SKU
    variants.add(sku.trim());
    return Array.from(variants);
}

/**
 * Main function to initiate processing of shipments.
 * It attaches parsed mailparser data to the input structure, processes shipments,
 * and if any errors occurred during processing, it throws an error with all error messages.
 * @param {object} inputData - Input data containing mailparser and API keys.
 * @returns {Array} Array of shipment update result objects.
 */
async function run(inputData) {
    // Combine inputData with the parsed mailparser content.
    const data = { ...inputData, mailparser: parsedMail };
    const storeMapping = getStoreMapping(data);
    const shippingMethodsMapping = getShippingMethodsMapping();
    const results = await processShipments(data, storeMapping, shippingMethodsMapping);
    
    // Aggregate errors from shipment processing.
    const errorResults = results.filter(r => r.status === "Error" || r.error);
    if (errorResults.length > 0) {
        // Combine all error messages into one error string.
        const combinedErrors = errorResults
            .map(r => `Shipment ${r.shipment}: ${r.error}`)
            .join("; ");
        throw new Error(`Shipments processed with errors: ${combinedErrors}`);
    }
    return results;
}

/**
 * Processes all shipments found in the mail attachments.
 * @param {object} data - Input data with parsed mail attachments.
 * @param {object} storeMapping - Mapping of store configurations.
 * @param {object} shippingMethodsMapping - Mapping for shipping method names.
 * @returns {Array} Array of shipment update result objects.
 */
async function processShipments(data, storeMapping, shippingMethodsMapping) {
    const shipments = data.mailparser && data.mailparser.mail_attachments;
    if (!Array.isArray(shipments) || shipments.length === 0) {
        throw new Error("No shipments found in data.mailparser.mail_attachments. Check your data structure.");
    }
    const results = [];
    for (const shipment of shipments) {
        try {
            const result = await processShipment(shipment, storeMapping, shippingMethodsMapping);
            results.push(result);
        } catch (error) {
            // Capture error details for this shipment and continue processing
            results.push({
                shipment: shipment.edwards_order_number,
                error: error.message,
                status: "Error"
            });
            console.error(`Error processing shipment ${shipment.edwards_order_number}:`, error);
        }
    }
    return results;
}

/**
 * Processes an individual shipment.
 * Validates shipment data, looks up order details, maps shipping methods,
 * matches SKUs, and finally updates the order with shipment information.
 * @param {object} shipment - Data for a single shipment.
 * @param {object} storeMapping - Store configuration mapping.
 * @param {object} shippingMethodsMapping - Mapping for shipping method conversions.
 * @returns {object} The result of the shipment update.
 */
async function processShipment(shipment, storeMapping, shippingMethodsMapping) {
    console.log("Processing Shipment", shipment);
    const cleanedCustomerPO = shipment.customer_po.replace(/-S(\d+|#)$/, "");
    if (cleanedCustomerPO.includes("239457") || cleanedCustomerPO.includes("239558") || cleanedCustomerPO.includes("155255")) {
        console.log(`B2B Order: ${cleanedCustomerPO}`);
        return { shipment: shipment.edwards_order_number, message: "B2B Order skipped" };
    }
    const splitPO = cleanedCustomerPO.split("-");
    let storeId, orderId;
    if (splitPO.length === 2) {
        [storeId, orderId] = splitPO;
    } else if (splitPO.length >= 3) {
        [, storeId, orderId] = splitPO;
    } else {
        throw new Error(`processShipment: Invalid customer_po format: ${cleanedCustomerPO}`);
    }
    if (!/^\d+$/.test(storeId)) {
        throw new Error(`processShipment: storeId is not valid (non-digit characters found): ${storeId}`);
    }
    const storeInfo = storeMapping[storeId];
    if (!storeInfo) {
        throw new Error(`processShipment: storeId ${storeId} does not match any stores.`);
    }
    const { url: storeUrl, apiKey } = storeInfo;
    const orderData = await orderLookup(orderId, storeUrl, apiKey);
    if (!orderData.line_items) {
        throw new Error(`processShipment: Invalid order data received for orderId ${orderId}`);
    }
    const mappedShippingMethod =
        getShippingMethodsMapping()[shipment.ship_via_description] || shipment.ship_via_description;
    const modifiedStockItem = `${storeInfo.skuPrefix}${shipment.stock_item}`;
    const shipmentVariants = getSkuVariants(modifiedStockItem);
    const matchedItems = orderData.line_items.reduce((matches, item) => {
        if (shipmentVariants.some(skuVar => getSkuVariants(item.final_sku).includes(skuVar))) {
            matches.push({
                id: item.id,
                quantity: Math.round(Number(shipment.item_qty)),
            });
        }
        return matches;
    }, []);
    if (!matchedItems.length) {
        throw new Error(`processShipment: No matching SKU found for shipment with SKU variations: ${shipmentVariants.join(" | ")}`);
    }
    const today = new Date().toISOString().slice(0, 10);
    const updateOrderPayload = JSON.stringify({
        shipment: {
            tracking_number: shipment.tracking_number,
            send_shipping_confirmation: true,
            ship_date: shipment.shipment_date,
            note: `Updated Via Edwards Shipment Doc Through Centricity API on ${today}`,
            shipping_method: mappedShippingMethod,
            line_items: matchedItems,
        },
    });
    const updateResult = await updateOrder(orderId, storeUrl, apiKey, updateOrderPayload, "bundled", shipment.tracking_number);
    return updateResult;
}

/**
 * Looks up order details using the given orderId.
 * @param {string} orderId - The order identifier.
 * @param {string} storeUrl - Base URL for the store.
 * @param {string} apiKey - API key for authentication.
 * @returns {Promise<object>} The order data as a JSON object.
 */
async function orderLookup(orderId, storeUrl, apiKey) {
    const url = `${storeUrl}api/v2.3.0/orders/${orderId}?token=${apiKey}`;
    const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: { Accept: "application/json" },
    });
    if (!response.ok) {
        const text = await response.text();
        console.error(`API Request Rejected: URL: ${url}, Status: ${response.status}, Response: ${text}`);
        throw new Error(`orderLookup: Response not ok for orderId ${orderId}, status: ${response.status}`);
    }
    return response.json();
}

/**
 * Updates an order with the provided shipment details.
 * Sends a POST request to update shipment info and logs the result.
 * @param {string} orderId - The order identifier.
 * @param {string} storeUrl - Base URL for the store.
 * @param {string} apiKey - API key for authentication.
 * @param {string} payload - JSON string containing shipment update data.
 * @param {string} itemId - Identifier for the order item (or bundled indicator).
 * @param {string} trackingNumber - Tracking number for the shipment.
 * @returns {object} An object representing the update result.
 */
async function updateOrder(orderId, storeUrl, apiKey, payload, itemId, trackingNumber) {
    const url = `${storeUrl}api/v2.3.0/orders/${orderId}/shipments?token=${apiKey}`;
    const response = await fetch(url, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "application/json" },
        body: payload,
    });
    if (!response.ok) {
        const text = await response.text();
        console.error(`API Request Rejected:
            URL: ${url}
            Status: ${response.status}
            Payload: ${payload}
            Response: ${text}`);
        throw new Error(`updateOrder: Response not ok for item ${itemId}, tracking: ${trackingNumber}, status: ${response.status}`);
    }
    console.log(`Item Shipping Updated ${itemId} with tracking number ${trackingNumber}`);
    return {
        orderId,
        itemId,
        trackingNumber,
        status: "Success"
    };
}

// Start processing shipments and update the global output with the results.
run(inputData)
    .then(results => {
         output = results;
         console.log("All shipments processed:", results);
    })
    .catch(error => {
         console.error(error);
         // Optionally update the global output with the error if desired.
         output = [{ error: error.message }];
    });

output = [{
    // This global variable will hold the array of shipment update result objects after processing.
}];


