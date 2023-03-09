require('dotenv').config()
const path = require('path')
global.root = path.resolve(__dirname)
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args))
const fs = require('fs')
const ethers = require("ethers")
const abi = require('./abi.json')
const ws_url = process.env.WS_URL
const provider_url = process.env.PROVIDER_URL
const address = process.env.CONTRACT_ADDRESS
const auctionAddress = process.env.AUCTION_ADDRESS
const config = require('./config.json')

const ERC20Tokens = [
    {address: "0x965F527D9159dCe6288a2219DB51fc6Eef120dD1", decimals: 18, name: "BSW"},
    {address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, name: "USDT"},
    {address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18, name: "BNB"},
    {address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", decimals: 18, name: "BUSD"}
]
const whitelistedNFT = [
    {address: "0xD4220B0B196824C2F548a34C47D81737b0F6B5D6", name: "Biswap Robbies Earn"},
    {address: "0x6650eD9411187b808A526e5fEF6F0DFB0b7591E7", name: "Collectibles"},
    {address: "0x6B58c1De5A26C25807AEaECB4E1CDCB5Acf58629", name: "Collection"},
]
const EXPECTED_PONG_BACK = 15000
const KEEP_ALIVE_CHECK_INTERVAL = 7500

async function observing() {
    let pingTimeout = null
    let keepAliveInterval = null
    const provider = new ethers.providers.WebSocketProvider(ws_url)
    const providerForCalls = new ethers.providers.JsonRpcProvider(provider_url)

    provider._websocket.on('open', () => {
        keepAliveInterval = setInterval(() => {

            provider._websocket.ping()
            pingTimeout = setTimeout(() => {
                provider._websocket.terminate()
            }, EXPECTED_PONG_BACK)
        }, KEEP_ALIVE_CHECK_INTERVAL)

        const listenedContract = new ethers.Contract(address, abi, provider)
        const auctionContract = new ethers.Contract(auctionAddress, abi, provider)
        auctionContract.on("NewAuction", async (id, seller, dealTokenAddress, nftPrice, _, nft)=>{
            console.log('sell caught', id)
            const dealNft = whitelistedNFT.find(({address}) => address === nft.nft);
            const dealToken = ERC20Tokens.find(({address}) => address === dealTokenAddress);
            const token = dealToken.name
            const url = `https://marketplace.biswap.org/card/${nft.nft}/${nft.tokenId}`
            const price = nftPrice / Math.pow(10, dealToken.decimals)
            if (dealNft) {
                try {
                    let body = {
                        chat_id: config.chatId,
                        text: ` Новый аукцион\n
                        - Название коллекции:  ${dealNft.name}\n
                        - Цена: ${price + " " + token} \n
                        - ID транзакции: ${id}\n
                        - Ссылка на NFT: ${url}`,
                    }
                    const resp = await fetch(process.env.TELEGRAM_URI + "sendMessage", {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json;charset=utf-8',
                            "cache-control": "no-cache"
                        },
                        body: JSON.stringify(body)
                    })
                    console.log(resp)
                } catch (e) {
                    console.log(e, "ERROR ON AUCTION")
                }
            }
        })
        listenedContract.on("NewOffer", async (_, nftAddress, tokenID, dealTokenAddress, nftPrice, operation, transactionID) => {
                console.log('offer caught', transactionID)
                nftAddress = "0x6650eD9411187b808A526e5fEF6F0DFB0b7591E7"
                try {
                    transactionID = parseInt(transactionID)
                    tokenID = parseInt(tokenID)
                    operation = parseInt(operation)
                    let collectionName = ""
                    let token = ""
                    let price = nftPrice
                    const dealNft = whitelistedNFT.find(({address}) => address === nftAddress);

                    if (dealNft && operation === 0) {

                        collectionName = dealNft.name
                        const dealToken = ERC20Tokens.find(({address}) => address === dealTokenAddress);
                        token = dealToken.name
                        const originPrice = nftPrice / Math.pow(10, dealToken.decimals)
                        price = price / Math.pow(10, dealToken.decimals)

                        let isBSW = false
                        if (token !== "BSW") {
                            try {
                                let data = await fetch(`https://rest.coinapi.io/v1/exchangerate/BSW/${token}`, {
                                    headers: {
                                        'X-CoinAPI-Key': process.env.COIN_API_KEY
                                    },
                                })
                                data = await data.json()
                                price /= data.rate

                            } catch (e) {
                                switch (token){
                                    case "USDT":
                                        price /= 0.184
                                        break;
                                    case "BNB":
                                        price /= 0.000661
                                        break;
                                    case "BUSD":
                                        price /= 0.184
                                        break;
                                }

                                console.log(e)
                            }

                        } else {
                            isBSW = true
                        }
                        price = Math.floor(price * 100) / 100
                        const jsonNFT = await getJson(collectionName, tokenID)
                        switch (collectionName) {
                            case "Biswap Robbies Earn": {

                                const {name, attributes, image} = jsonNFT
                                const robiBoost = parseInt(attributes.robiBoost.substring(0, attributes.robiBoost.indexOf('/')))
                                const level = parseInt(attributes.level)

                                if (
                                    (level === 3 && robiBoost === 1000 && price <= config.Robi_level_3_cost_last_robiboost)
                                    ||
                                    (
                                        (level === 4 && price <= config.Robi_level_4_cost)
                                        ||
                                        (level === 4 && robiBoost === 10000 && price <= config.Robi_level_4_cost_last_robiboost)
                                    ) ||
                                    (
                                        (level === 5 && price <= config.Robi_level_5_cost)
                                        ||
                                        (level === 5 && robiBoost === 33000 && price <= config.Robi_level_5_cost_last_robiboost)
                                    ) ||
                                    (
                                        (level === 6 && robiBoost >= 110000 && price <= config.Robi_level_6_cost)
                                    )) {
                                    await examination(name, tokenID, collectionName, robiBoost, {price: price, dealToken: token, originPrice: originPrice}, transactionID, nftAddress, image, "photo", isBSW)
                                } else {
                                    if(level > 2){
                                        await pushTelegram(name, tokenID, collectionName, robiBoost, {price: price, dealToken: token, originPrice: originPrice}, transactionID, nftAddress, image, "opened", "photo")
                                    }
                                }
                                break;
                            }
                            case "Collectibles": {

                                let {name, attributes, video, image, preview} = jsonNFT
                                let photoOrVideo
                                if(video){
                                    photoOrVideo = "video"
                                    video = preview

                                } else {
                                    photoOrVideo = "photo"
                                    video = image

                                }
                                const level = parseInt(attributes.level)
                                if ((level === 1 && price < config.Collectibles_level_1_cost) ||
                                    (level === 2 && price < config.Collectibles_level_2_cost) ||
                                    (level === 3 && price < config.Collectibles_level_3_cost) ||
                                    (level === 4 && price < config.Collectibles_level_4_cost) ||
                                    (level === 5 && price < config.Collectibles_level_5_cost)) {
                                    await examination(name, tokenID, collectionName, attributes.level, {price: price, dealToken: token, originPrice: originPrice}, transactionID, nftAddress, video, photoOrVideo, isBSW)
                                } else {
                                    await pushTelegram(name, tokenID, collectionName, attributes.level, {price: price, dealToken: token, originPrice: originPrice}, transactionID, nftAddress, video, "opened", photoOrVideo)
                                }
                                break;
                            }
                        }
                    }
                } catch (e) {
                    console.log(e, "ERROR ON OFFER")
                }

            }
        )
        listenedContract.on("AcceptOffer", async (transactionID, user, _) => {
            console.log('accept caught', transactionID)
            try {
                transactionID = parseInt(transactionID)
                const contract = new ethers.Contract(address, abi, providerForCalls);
                const info = await contract.offers(transactionID)
                const nftAddress = info.nft
                const tokenID = info.tokenId
                const dealNft = whitelistedNFT.find(({address}) => address === nftAddress);
                const dealTokenAddress = info.dealToken
                if (dealNft) {
                    const collectionName = dealNft.name
                    const dealToken = ERC20Tokens.find(({address}) => address === dealTokenAddress);
                    let price = info.price
                    price = price / Math.pow(10, dealToken.decimals)
                    price = Math.floor(price * 100) / 100

                    const jsonNFT = await getJson(collectionName, tokenID)
                    switch (collectionName) {
                        case "Biswap Robbies Earn": {

                            const {name, attributes, image} = jsonNFT
                            const robiBoost = parseInt(attributes.robiBoost.substring(0, attributes.robiBoost.indexOf('/')))

                            await pushTelegram(name, tokenID, collectionName, robiBoost, { price:`${price} ${dealToken.name}`}, transactionID, nftAddress, image, "purchased", "photo")

                            break;
                        }
                        case "Collectibles": {

                            let {name, attributes, video, image, preview} = jsonNFT
                            let photoOrVideo
                            if(video){
                                photoOrVideo = "video"
                                video = preview
                            } else {
                                photoOrVideo = "photo"
                                video = image
                            }
                            await pushTelegram(name, tokenID, collectionName, attributes.level, { price:`${price} ${dealToken.name}`}, transactionID, nftAddress, video, "purchased", photoOrVideo)

                            break;
                        }
                    }

                }
            } catch (e) {
                console.log(e, "ERROR ON ACCEPT")
            }

        })

    })

    provider._websocket.on('close', () => {
        console.log('The websocket connection was closed')
        clearInterval(keepAliveInterval)
        clearTimeout(pingTimeout)
        setTimeout(() => {
            observing()
        }, 3000)
    })

    provider._websocket.on('error', () => {
        console.log('error occurred')

    })

    provider._websocket.on('pong', () => {
        clearInterval(pingTimeout)
    })

}
async function getJson(collection, tokenID){
    let jsonNFT;
    let url;
    switch (collection) {
        case "Biswap Robbies Earn":
            url = "nft"
            break;
        case "Collectibles":
            url = "collectibles-nft"
            break;
    }
    try{
        const meta = await fetch(`https://api.webscraping.ai/html?api_key=${process.env.SCRAPPING_KEY_1}&url=https://biswap.org/back/${url}/metadata/${tokenID}&proxy=datacenter&js=false`)

        jsonNFT = await meta.json()

    } catch (e) {
        console.log(e)
        const meta = await fetch(`https://proxy.scrapeops.io/v1/?api_key=${process.env.SCRAPPING_KEY_2}&url=https://biswap.org/back/${url}/metadata/${tokenID}`)
        jsonNFT = await meta.json()
    }
    return jsonNFT
}
async function examination(name, tokenID, collectionName, robiBoost, token, transactionID, nftAddress, image, photoOrVideo, isBSW){
    if(
        (config.one_coin_purchase && isBSW || !config.one_coin_purchase)
        &&
        ((config.disposable_purchase && config.disposable_iterator === 0) || config.multiple_purchase === true)
    ){

        const confirm = await purchase(transactionID)
        if(confirm === true){
            await pushTelegram(name, tokenID, collectionName, robiBoost, token, transactionID, nftAddress, image, "fulfilled", photoOrVideo)
        } else {
            await pushTelegram(name, tokenID, collectionName, robiBoost, token, transactionID, nftAddress, image, "rejected", photoOrVideo)
        }
        if(config.disposable_purchase && config.disposable_iterator === 0 && confirm === true){
            config.disposable_iterator = 1
            fs.writeFile(path.join(__dirname, "config.json"), JSON.stringify(config), 'utf8', err => {
                if (err) throw err;
                console.log('File has been saved!');
            });
        }
    } else {
        await pushTelegram(name, tokenID, collectionName, robiBoost, token, transactionID, nftAddress, image, "satisfied", photoOrVideo)
    }


}
async function purchase(transactionID){
    try {
        const PRIVATE_KEY = process.env.PRIVATE_KEY
        const provider = new ethers.providers.JsonRpcProvider(provider_url)
        const signer = new ethers.Wallet(PRIVATE_KEY, provider);
        const contract = new ethers.Contract(address, abi, provider);
        const contractWithSigner = contract.connect(signer);

        const gas_price = await provider.getGasPrice();
        const overrides = {
            from: await signer.getAddress(),
            gasLimit: ethers.utils.hexlify(1000000),
            gasPrice: gas_price,
            nonce: provider.getTransactionCount(await signer.getAddress()),
        }

        const tx = await contractWithSigner.accept(transactionID, overrides)
        if(await tx.wait()){
            console.log(await tx)
            return true
        } else {
            return false
        }
    }
    catch (e) {
        console.log(e, "ERROR ON PURCHASE")
        return false
    }
}
async function pushTelegram(name, tokenID, collectionName, rarity, token, transactionID, nftAddress, imageURL, state, photoOrVideo) {
    try {
        let needToShow = ""
        if (token.dealToken){
            needToShow = `\n- Оффер выставлен в ${token.dealToken} (${token.originPrice})`
        }
        let telegram_uri
        let rarity_descr
        let imageOrVideo
        let prefix
        const url = `https://marketplace.biswap.org/card/${nftAddress}/${tokenID}`
        switch (state) {
            case "fulfilled":
                prefix = "✅✅✅ Совершена покупка\n"
                token.price = token.price + " BSW"
                break;
            case "rejected":
                prefix = "❗ ❗ ❗ Недостаточно денег на балансе\n"
                token.price = token.price + " BSW"
                break;
            case "purchased":
                prefix = "💵💵💵 Оффер выкуплен\n"
                break;
            case "satisfied":
                prefix = "⭕⭕⭕ Оффер который удовлетворяет условиям однако не был куплен\n"
                token.price = token.price + " BSW"
                break;
            case "opened":
                prefix = "⛔⛔⛔ Новый оффер который не прошел проверку\n"
                token.price = token.price + " BSW"
                break;
            default:
                prefix = "⚫⚫⚫ Internal Server Error\n"
                break;
        }
        switch (collectionName) {
            case "Biswap Robbies Earn":
                rarity_descr = "- RobiBoost"
                break;
            case "Collectibles":
                rarity_descr = "- Level"
                break;
            default:
                rarity_descr = "- none, error"
                break;

        }
        switch (photoOrVideo) {
            case 'photo':
                imageOrVideo = "photo"
                telegram_uri = process.env.TELEGRAM_URI + "sendPhoto"
                break;
            case 'video':
                imageOrVideo = "video"
                telegram_uri = process.env.TELEGRAM_URI + "sendVideo"
                break;
        }

        let body = {
            chat_id: process.env.CHAT_ID,
            caption: `${prefix}- Название NFT: ${name}\n
                               - Токен ID: ${tokenID}\n
                               - Название коллекции: ${collectionName}\n
                               ${rarity_descr}: ${rarity}\n
                               - Цена: ${token.price} ${needToShow} \n
                               - ID транзакции: ${transactionID}\n
                               - Ссылка на NFT: ${url}`,
        }

        body[imageOrVideo] = imageURL

        const resp = await fetch(telegram_uri, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=utf-8',
                "cache-control": "no-cache"
            },
            body: JSON.stringify(body)
        })
        if (resp.status === 400){
             console.log(imageURL)
             console.log(body, process.env.CHAT_ID)
            await fetch(telegram_uri, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json;charset=utf-8',
                    "cache-control": "no-cache"
                },
                body: JSON.stringify(body)
            })
        } else {
            console.log(resp)
        }
    } catch (e) {
        console.log(e)
    }


}

module.exports =  observing()

