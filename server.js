require('dotenv').config()



const fs = require('fs');
const express = require('express');
const jwt = require('jsonwebtoken');


var port = process.env.SERVER_PORT || 80;



var publicKey = fs.readFileSync(process.env.PUBLIC_KEY,"utf8")
var routePrefix = process.env.ROUTE_PREFIX || '/order' 



function startServer() {
    var app = express();

    app.use(express.json());

    app.get("/", async (req, res) => {
        res.status(404).send("unrecognized route")
    });
    app.get(routePrefix+'/basket/list',  async (req, res) => {
        res.send([{
            "id":1,
            "catalogId":1,
            "quantity":1,
            "name":"sticker",
            "imgurl":"https://www.kasten.io/hubfs/Kasten%20logos/logo-kasten.io.svg",
        }])
    })
    app.post(routePrefix+'/basket/add',  async (req, res) => {
        res.send({"status":"success"})
    })
    app.post(routePrefix+'/main/create',  async (req, res) => {
        res.send({
            "status":"success",
            "id":3,
            "name":(new Date())
        })
    })

    app.get(routePrefix+'/main/list', async (req, res) => {
        res.send([
            {
                "id":1,
                "name":((new Date("2022-11-11T20:00:00Z")))  
            },
            {
                "id":2,
                "name":((new Date("2022-11-12T20:00:00Z")))  
            }
        ])
    })
    //only works up to 9 but who cares
    app.get(routePrefix+'/main/list/:orderId([0-9]+)', async (req, res) => {
        res.send({
            "id":req.params.orderId,
            "name":((new Date("2022-11-1"+req.params.orderId+"T20:00:00Z"))),
            "items":[
                {
                        "id":1,
                        "catalogId":1,   
                        "quantity":1,
                        "name":"name",
                        "imgurl":"https://",
                }       
            ]
        })
    })
    
    app.listen(port, () => {
     console.log("Server running on port "+port);
    });   
    
}


console.log("Starting fake order svc")

startServer()


