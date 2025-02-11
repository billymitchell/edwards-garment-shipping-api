# Shipping API for Edwards

This project processes shipment information received from Edwards and updates orders accordingly. It maps incoming shipment details (such as SKUs and shipping methods) to internal representations, bundles order items sharing the same tracking number into a single request, and makes API calls to update orders with detailed shipment information.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Environment Variables](#environment-variables)
- [Usage](#usage)
  - [Running in Testing Mode](#running-in-testing-mode)
  - [Running in Production Mode](#running-in-production-mode)
- [Code Overview](#code-overview)
  - [Processing Shipments](#processing-shipments)
  - [SKU Variants Generation](#sku-variants-generation)
  - [Mapping Shipping Methods](#mapping-shipping-methods)
  - [API Calls](#api-calls)
- [Error Handling & Logging](#error-handling--logging)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Prerequisites

- [Node.js](https://nodejs.org/) (v12 or later)
- [npm](https://www.npmjs.com/)

## Setup

1. **Clone the Repository**

   ```bash
   git clone <repository-url>
   cd Shipping-API/edwards