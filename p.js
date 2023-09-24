const axios = require("axios");
const TelegramBot = require("node-telegram-bot-api");

const botToken = "6444387260:AAGQxfoMZJtB1MWZwFS1W0TARf85dj2bpAA"; // Replace with your Telegram Bot Token
const chatId = "564739921"; // Replace with your Telegram Chat ID
const POLLING_INTERVAL = 3000; // 2 minutes in milliseconds

const priceChangeApiUrl = "https://api.binance.com/api/v3/ticker/24hr";
const futuresInfoApiUrl = "https://fapi.binance.com/fapi/v1/exchangeInfo";

const processedOrders = new Map();
let futuresSymbolsCache = [];
const lastPercentageChangeMap = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const bot = new TelegramBot(botToken, {
  polling: false,
});

async function fetchAndStoreFuturesPairs() {
  try {
    const futuresInfoResponse = await axios.get(futuresInfoApiUrl);
    if (futuresInfoResponse.status === 200) {
      futuresSymbolsCache = futuresInfoResponse.data.symbols.map(
        (pair) => pair.symbol
      );
    } else {
      console.error("Failed to fetch futures exchange info. Status code:", futuresInfoResponse.status);
    }
  } catch (error) {
    console.error("Error fetching futures exchange info:", error.message);
  }
}

// Fetch and store all Binance Futures pairs at the beginning
fetchAndStoreFuturesPairs();

async function fetchAndProcessData() {
  try {
    const priceChangeResponse = await axios.get(priceChangeApiUrl);
    if (priceChangeResponse.status === 200) {
      const priceChangeData = priceChangeResponse.data;

      for (const item of priceChangeData) {
        const symbol = item.symbol;
        if (symbol.endsWith("USDT")) {
          const priceChangePercent = parseFloat(item.priceChangePercent);
          if (Math.abs(priceChangePercent) >= 5 && await isTradingPairAvailableOnFutures(symbol)) {
            const orderBookUrl = `https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=20`;
            
            if (!processedOrders.has(symbol)) {
              processedOrders.set(symbol, {
                buyTotalAmount: 0,
                sellTotalAmount: 0,
                totalQuantity: 0,
                lastPriceChangePercent: 0,
              });
            }

            try {
              let response;
              let retries = 0;
              do {
                response = await axios.get(orderBookUrl);
                if (response.status === 429) {
                  const retryAfter = response.headers["retry-after"] || 5;
                  console.log(`Rate limit exceeded. Waiting ${retryAfter} seconds before retrying...`);
                  await delay(retryAfter * 1000);
                  retries++;
                }
              } while (response.status === 429 && retries < 5);

              if (response.status === 200) {
                const { bids, asks } = response.data;

                if (Array.isArray(bids) && Array.isArray(asks) && bids.length > 0 && asks.length > 0) {
                  const totalBuyAmount = bids.reduce((total, [price, quantity]) => total + calculateAmountInDollars(price, quantity), 0);
                  const totalSellAmount = asks.reduce((total, [price, quantity]) => total + calculateAmountInDollars(price, quantity), 0);
                  const totalQuantity = bids.reduce((total, [, quantity]) => total + parseFloat(quantity), 0);

                  if (Math.abs(totalBuyAmount - totalSellAmount) > 10000 && totalBuyAmount > 10000) {
                    const buyOrSell = totalBuyAmount > totalSellAmount ? "Buy" : "Sell";
                    const lastPriceChangePercent = lastPercentageChangeMap.get(symbol);

                    if (!lastPriceChangePercent || Math.abs(priceChangePercent - lastPriceChangePercent) > 1) {
                      // Send the message to Telegram
                      bot.sendMessage(chatId, `v1 ${addColoredDot(buyOrSell)}${symbol} @ ${formatNumber(bids[0][0])}\n${buyOrSell} Quantity ${formatWithCommas(totalQuantity.toFixed(2))}\nAmount $${formatWithCommas(totalBuyAmount.toFixed(2))}\nchange (${priceChangePercent.toFixed(2)}%)`);
                      lastPercentageChangeMap.set(symbol, priceChangePercent);
                    }
                  }

                  const processedOrder = processedOrders.get(symbol);
                  processedOrder.buyTotalAmount += totalBuyAmount;
                  processedOrder.sellTotalAmount += totalSellAmount;
                } else {
                  console.error(`Unexpected response data structure for ${symbol}.`);
                }
              } else {
                console.error(`Failed to fetch order book data for ${symbol}. Status code: ${response.status}`);
              }
            } catch (orderBookError) {
              console.error(`Error fetching order book data for ${symbol}:`, orderBookError.message);
            }
          }
        }
      }
    } else {
      console.error("Failed to fetch 24-hour percentage change data. Status code:", priceChangeResponse.status);
    }
  } catch (error) {
    console.error("Error fetching data:", error.message);
  }
}

// Fetch and process data periodically
setInterval(fetchAndProcessData, POLLING_INTERVAL);

// Function to check if a trading pair is available on Binance Futures
async function isTradingPairAvailableOnFutures(symbol) {
  return futuresSymbolsCache.includes(symbol);
}

function calculateAmountInDollars(price, quantity) {
  return parseFloat(price) * parseFloat(quantity);
}

function formatNumber(number) {
  return Number(number).toString();
}

function formatWithCommas(number) {
  return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function addColoredDot(orderType) {
  if (orderType === "Buy") {
    return "🟢";
  } else if (orderType === "Sell") {
    return "🔴";
  } else {
    return "";
  }
}
