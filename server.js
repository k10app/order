require('dotenv').config()



const fs = require('fs');
const express = require('express');
const { Pool } = require('pg');
const { expressjwt: jwt } = require("express-jwt");
const bent = require('bent');
const cors = require("cors");

const {Basket} = require("./basket.js")
const {Order} = require("./order.js")
const { timeStamp,audit } = require("./utils.js");

var port = process.env.SERVER_PORT || 80;



const catalogLinkOptions = {
    hostname: (process.env.CATALOG_SERVER || 'localhost'),
    port: (process.env.CATALOG_PORT || '80'),
    path: (process.env.CATALOG_PREFIX || '/catalog'),
};

const catalogLink = "http://"+catalogLinkOptions.hostname+":"+catalogLinkOptions.port+catalogLinkOptions.path
console.log("Linking to catalog via "+catalogLink)

const catalogGetItem = bent(catalogLink+'/list/','json')
const catalogUpdateStock = bent(catalogLink+'/bulkStockUpdate','POST','json')







var publicKey = fs.readFileSync(process.env.PUBLIC_KEY,"utf8")
var routePrefix = process.env.ROUTE_PREFIX || '/order' 


const postgresPool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost', 
    port: process.env.POSTGRES_PORT || '5432',
    user: process.env.POSTGRES_USER || 'orderlogin', 
    password: process.env.POSTGRES_PASSWORD || 'orderpassword',
    database: process.env.POSTGRES_DATABASE || 'order',
    max: 20
})





function startServer() {
    const basket = new Basket(postgresPool,catalogGetItem)
    const order = new Order(postgresPool,catalogUpdateStock)

    var app = express();

    app.use(express.json());
    app.use(cors());

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
        console.log("404 on ",req.originalUrl)
        res.status(404).send("unrecognized route")
    });
    app.post("/", async (req, res) => {
        console.log("404 on ",req.originalUrl,req.body)
        res.status(404).send("unrecognized route")
    });

    app.get(routePrefix+'/basket/list',  basket.list)
    app.post(routePrefix+'/basket/add',  basket.add)
    app.delete(routePrefix+'/basket/delete/:select(all|[0-9]+)',  basket.delete)

    app.post(routePrefix+'/main/create',  order.create)
    app.post(routePrefix+'/main/pay/:orderId([0-9]+)',  order.pay)
    app.get(routePrefix+'/main/list', order.list)
 
    app.get(routePrefix+'/main/list/:orderId([0-9]+)', async (req, res) => {
        audit(req)

        postgresClient = await postgresPool.connect()

        let orderId = req.params.orderId
        let userId = req.auth.login

        postgresClient.query(`SELECT "id","orderName","status","totalPrice" FROM "order" WHERE "userId" = $1 AND "id" = $2`,[userId,orderId]).then(
            (queryResult) => {
                if(queryResult.rowCount == 0) {
                    res.send({})
                } else {
                    postgresClient.query(`SELECT * FROM "orderItem" WHERE "userId" = $1 AND "orderId" = $2`,[userId,orderId]).then(
                        (itemQueryResult)=> {
                            var orderObject = function(id,name,status,totalPrice,items) {
                                return {
                                    id:orderId,
                                    name:name,
                                    status:status,
                                    totalPrice:totalPrice,
                                    items:items}
                            }
                            if(itemQueryResult.rowCount == 0) {
                                res.send(orderObject(queryResult.rows[0].id,
                                    queryResult.rows[0].orderName,
                                    queryResult.rows[0].status,
                                    queryResult.rows[0].totalPrice,
                                    []))
                            } else {
                                res.send(orderObject(queryResult.rows[0].id,
                                    queryResult.rows[0].orderName,
                                    queryResult.rows[0].status,
                                    queryResult.rows[0].totalPrice,
                                    itemQueryResult.rows))
                            }
                        },
                        (err) => {
                            console.log(err)
                            res.status(403).send("internal error")
                        }
                    )
                }
            },
            (err) => {
                console.log(err)
                res.status(403).send("internal error")
            }
        )
        postgresClient.release()
    })
    

    app.delete(routePrefix+'/main/delete/:select(all|[0-9]+)',  async (req, res) => {
        audit(req)

        postgresClient = await postgresPool.connect()

        var selectValue = req.params.select
        
        try {
            await postgresClient.query('BEGIN')
            
            switch(selectValue) {
                case "all": 
                    await postgresClient.query(`DELETE FROM "orderItem" WHERE "userId" = $1`,[req.auth.login])
                    await postgresClient.query(`DELETE FROM "order" WHERE "userId" = $1`,[req.auth.login])
                    break;
                default: 
                    await postgresClient.query(`DELETE FROM "orderItem" WHERE "userId" = $1 AND "orderId" = $2`,[req.auth.login,selectValue])
                    await postgresClient.query(`DELETE FROM "order" WHERE "userId" = $1 AND id = $2`,[req.auth.login,selectValue])
            }
            postgresClient.query('COMMIT').then(
                (dbResult) => {
                    res.send({"status":"ok"})
                },
                (err) => {
                    console.log("delete error "+err)
                    res.status(403).send("internal error")
                } 
            )
        } catch (err) {
            await postgresClient.query('ROLLBACK')
            res.status(500).send("internal error on delete")
            console.log("Could not process delete order transaction ",err)
        } finally {
            postgresClient.release()   
        }
        
    })


    app.listen(port, () => {
     console.log("Server running on port "+port);
    });   
    
}


async function run() {
    postgresClient = await postgresPool.connect()
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
        "orderName" text,
        "userName" text,
        "street" text,
        "PObox" text,
        "city" text,
        "postcode" text,
        "country" text,
        "totalPrice" numeric(15,2) DEFAULT 0,
        "status" text DEFAULT 'init',
        PRIMARY KEY( id )
    );
    CREATE TABLE IF NOT EXISTS "orderItem" (
        "id" serial,
        "userId" text,
        "orderId" text,
        "catalogId" text,
        "name" text,
        "imgurl" text,
        "quantity" numeric(9,0),
        "price" numeric(12,2),
        "totalPrice" numeric(14,2),
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





