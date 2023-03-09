const express = require("express")


const PORT = 3000;

const app = express()

async function startApp(){
    try {

        app.listen(PORT,() => console.log('SERVER STARTED ON PORT http://localhost:' + PORT))
        app.keepAliveTimeout = 15000;

        await require("./observing")

    } catch (e) {
        console.log(e)
    }
}
startApp()
