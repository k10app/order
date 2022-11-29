require('dotenv').config()



const fs = require('fs');
const express = require('express');
const { Pool } = require('pg');
const { expressjwt: jwt } = require("express-jwt");
const bent = require('bent');

var port = process.env.SERVER_PORT || 80;



const catalogLinkOptions = {
    hostname: (process.env.CATALOG_SERVER || 'localhost'),
    port: (process.env.CATALOG_PORT || '80'),
    path: (process.env.CATALOG_PREFIX || '/catalog'),
};

const catalogLink = "http://"+catalogLinkOptions.hostname+":"+catalogLinkOptions.port+catalogLinkOptions.path
console.log("Linking to catalog via "+catalogLink)

const catalogGetItem = bent(catalogLink+'/list/','json')







var publicKey = fs.readFileSync(process.env.PUBLIC_KEY,"utf8")
var routePrefix = process.env.ROUTE_PREFIX || '/order' 


const postgresClient = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost', 
    port: process.env.POSTGRES_PORT || '5432',
    user: process.env.POSTGRES_USER || 'orderlogin', 
    password: process.env.POSTGRES_PASSWORD || 'orderpassword',
    database: process.env.POSTGRES_DATABASE || 'order',
    max: 20
})


function startServer() {
    var app = express();

    app.use(express.json());

    //jwt validation
    app.use(
        jwt({secret:publicKey,algorithms:['RS256']})
    );

    app.use(function (err, req, res, next) {
        if (err.name === "UnauthorizedError") {
          res.status(401).send("Wrong cookie!");
        } else {
          next(err);
        }
    });

    app.get("/", async (req, res) => {
        res.status(404).send("unrecognized route")
    });
    app.get(routePrefix+'/basket/list',  async (req, res) => {
        //,
        postgresClient.query(`SELECT * FROM basket WHERE "userId" = $1`,[req.auth.login]).then(
            (queryResult)=> {
                if(queryResult.rowCount == 0) {
                    res.send([])
                } else {
                    res.send(queryResult.rows)
                }
                
            },
            (err) => {
                console.log(err)
                res.status(403).send("internal error")
            }
        )
    })
    app.post(routePrefix+'/basket/add',  async (req, res) => {
        let catalogId = ""+req.body.catalogId
       
        catalogGetItem(catalogId).then(
            (RESTResult) => {
                let params = [req.auth.login,catalogId,req.body.quantity,RESTResult.name,RESTResult.imgurl,RESTResult.price]
                postgresClient.query(`INSERT INTO basket ("userId","catalogId","quantity","name","imgurl","price") VALUES ($1,$2,$3,$4,$5,$6)`,params).then(
                    (queryResult)=> {
                        res.send({"status":"success"})
                    },
                    (err) => {
                        console.log(err)
                        res.status(403).send("internal error")
                    }
                )
            },
            (err) => {
                console.log("catalog query error "+err)
                res.status(403).send("invalid catalog id "+catalogId)
            }
        )

        

        
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


async function run() {
    await postgresClient.connect()
    postgresClient.query(`
      CREATE TABLE IF NOT EXISTS "basket" (
        "id" serial,
        "userId" text,
        "catalogId" text,
        "quantity" numeric(9,0),
        "price" numeric(12,2),
        "name" text,
        "imgurl" text,
        PRIMARY KEY( id )
    );
    CREATE TABLE IF NOT EXISTS "order" (
        "id" serial,
        "userId" text,
        "name" text,
        "totalPrice" numeric(14,2),
        PRIMARY KEY( id )
    );
    CREATE TABLE IF NOT EXISTS "orderItem" (
        "id" serial,
        "userId" text,
        "orderId" text,
        "catalogId" text,
        "quantity" numeric(9,0),
        "name" text,
        "imgurl" text,
        "price" numeric(12,2),
        PRIMARY KEY( id )
    );   
    `).then(
        (res) => {
            console.log("Starting fake order svc, db created if not exists")
            startServer()
        },
        (err) => {
            console.log("Error on init script ",err)
        }
    )

}
run().catch((reason) => {console.log(reason)})





