const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");

// Binance API URL for fetching 24-hour percentage change data
const priceChangeApiUrl = "https://api.binance.com/api/v3/ticker/24hr";

// Binance API URL for fetching futures exchange info
const futuresInfoApiUrl = "https://fapi.binance.com/fapi/v1/exchangeInfo";

// Function to calculate the total amount in dollars
function calculateAmountInDollars(price, quantity) {
  return parseFloat(price) * parseFloat(quantity);
}

// Data structure to store processed orders for each trading pair
const processedOrders = new Map();

// Cached data for trading pairs available on Binance Futures
let futuresSymbolsCache = [];

// Map to store the last percentage change for each symbol
const lastPercentageChangeMap = new Map();

// Define a function to delay execution for a specified number of milliseconds
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Function to fetch and store all Binance Futures pairs
async function fetchAndStoreFuturesPairs() {
  try {
    const futuresInfoResponse = await axios.get(futuresInfoApiUrl);
    if (futuresInfoResponse.status === 200) {
      futuresSymbolsCache = futuresInfoResponse.data.symbols.map(
        (pair) => pair.symbol
      );
    } else {
      console.error(
        "Failed to fetch futures exchange info. Status code:",
        futuresInfoResponse.status
      );
    }
  } catch (error) {
    console.error("Error fetching futures exchange info:", error.message);
  }
}

// Fetch and store all Binance Futures pairs at the beginning
fetchAndStoreFuturesPairs();

// Function to check if a trading pair is available on Binance Futures
async function isTradingPairAvailableOnFutures(symbol) {
  // Check if the symbol is in the cached list of Binance Futures pairs
  return futuresSymbolsCache.includes(symbol);
}

// Function to format a number by removing extra trailing zeros
function formatNumber(number) {
  return Number(number).toString();
}

// Function to format a number by adding commas for thousands separators
function formatWithCommas(number) {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Function to add colored dot based on the order type (buy or sell)
function addColoredDot(orderType) {
  if (orderType === "Buy") {
    return "🟢";
  } else if (orderType === "Sell") {
    return "🔴";
  } else {
    return "";
  }
}

// Initialize your Telegram Bot with the token
const bot = new TelegramBot("6444387260:AAGQxfoMZJtB1MWZwFS1W0TARf85dj2bpAA", {
  polling: false,
});

// Your channel's chat ID
const chatId = "564739921";

// Function to fetch and display the latest buy and sell orders for volatile USDT trading pairs
async function fetchLatestOrdersForVolatileUSDT() {
  try {
    // Fetch 24-hour percentage change data for all trading pairs
    const priceChangeResponse = await axios.get(priceChangeApiUrl);
    if (priceChangeResponse.status === 200) {
      const priceChangeData = priceChangeResponse.data;

      // Iterate through each trading pair and check if it meets the criteria
      for (const item of priceChangeData) {
        const symbol = item.symbol;
        // Check if the trading pair ends with "USDT"
        if (symbol.endsWith("USDT")) {
          // Check if the percentage change is >= 5% or <= -5%
          const priceChangePercent = parseFloat(item.priceChangePercent);
          if (Math.abs(priceChangePercent) >= 5) {
            // Check if the trading pair is available on Binance Futures
            if (await isTradingPairAvailableOnFutures(symbol)) {
              const orderBookUrl = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=5`;

              // Initialize the map for the current trading pair
              if (!processedOrders.has(symbol)) {
                processedOrders.set(symbol, {
                  buyTotalAmount: 0,
                  sellTotalAmount: 0,
                  totalQuantity: 0, // Initialize totalQuantity to 0
                  lastPriceChangePercent: 0, // Initialize lastPriceChangePercent to 0
                });
              }

              try {
                // Fetch the order book data for the current trading pair with retry logic
                let response;
                let retries = 0;
                do {
                  response = await axios.get(orderBookUrl);
                  if (response.status === 429) {
                    const retryAfter = response.headers["retry-after"] || 5;
                    console.log(
                      `Rate limit exceeded. Waiting ${retryAfter} seconds before retrying...`
                    );
                    await delay(retryAfter * 1000); // Wait before retrying
                    retries++;
                  }
                } while (response.status === 429 && retries < 5); // Retry up to 5 times

                if (response.status === 200) {
                  const { bids, asks } = response.data;

                  // Ensure that the response data contains the expected structure
                  if (
                    Array.isArray(bids) &&
                    Array.isArray(asks) &&
                    bids.length > 0 &&
                    asks.length > 0
                  ) {
                    // Calculate the total buy and sell amounts and total quantity for the batch
                    const totalBuyAmount = bids.reduce(
                      (total, [price, quantity]) => {
                        return (
                          total + calculateAmountInDollars(price, quantity)
                        );
                      },
                      0
                    );

                    const totalSellAmount = asks.reduce(
                      (total, [price, quantity]) => {
                        return (
                          total + calculateAmountInDollars(price, quantity)
                        );
                      },
                      0
                    );

                    const totalQuantity = bids.reduce((total, [, quantity]) => {
                      return total + parseFloat(quantity);
                    }, 0);

                    // Check if the net result is greater than $10,000 and the total buy amount is above $10,000
                    if (
                      Math.abs(totalBuyAmount - totalSellAmount) > 10000 &&
                      totalBuyAmount > 10000
                    ) {
                      const buyOrSell =
                        totalBuyAmount > totalSellAmount ? "Buy" : "Sell";

                      // Check if the previous percentage change is not defined or the change is greater than 1%
                      const lastPriceChangePercent =
                        lastPercentageChangeMap.get(symbol);

                      if (
                        !lastPriceChangePercent ||
                        Math.abs(priceChangePercent - lastPriceChangePercent) >
                          1
                      ) {
                        // Send the message to Telegram
                        bot.sendMessage(
                          chatId,
                           
                          `v1 ${addColoredDot(
                            buyOrSell
                          )}${symbol} @ ${formatNumber(
                            bids[0][0]
                          )} 
          ${buyOrSell} Quantity ${formatWithCommas(
            totalQuantity.toFixed(2)
          )} 
          Amount $${formatWithCommas(
            totalBuyAmount.toFixed(2)
          )} 
          change (${priceChangePercent.toFixed(2)}%)`
        );

                        // Update the lastPercentageChangeMap
                        lastPercentageChangeMap.set(symbol, priceChangePercent);
                      }
                    }

                    // Update the processedOrders map with the accumulated buy and sell amounts
                    const processedOrder = processedOrders.get(symbol);
                    processedOrder.buyTotalAmount += totalBuyAmount;
                    processedOrder.sellTotalAmount += totalSellAmount;
                  } else {
                    console.error(
                      `Unexpected response data structure for ${symbol}.`
                    );
                  }
                } else {
                  console.error(
                    `Failed to fetch order book data for ${symbol}. Status code: ${response.status}`
                  );
                }
              } catch (orderBookError) {
                console.error(
                  `Error fetching order book data for ${symbol}:`,
                  orderBookError.message
                );
              }
            }
          }
        }
      }
    } else {
      console.error(
        "Failed to fetch 24-hour percentage change data. Status code:",
        priceChangeResponse.status
      );
    }
  } catch (error) {
    console.error("Error fetching data:", error.message);
  }
}

// Fetch and display the latest buy and sell orders for volatile USDT trading pairs every 10 seconds
setInterval(fetchLatestOrdersForVolatileUSDT, 5000);
