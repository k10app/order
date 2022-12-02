require('dotenv').config()



const fs = require('fs');
const express = require('express');
const { Pool } = require('pg');
const { expressjwt: jwt } = require("express-jwt");
const bent = require('bent');
const cors = require("cors");

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


function timeStamp() {
    var d = new Date()
    lz = (res) => { return res<10?"0"+res:""+res}//leadingzero 01 .. 09 10
    return d.toDateString()+" "+lz(d.getHours())+":"+lz(d.getMinutes())
}

function audit(req) {
    console.log("Request",req.auth.login,req.originalUrl)
}
function startServer() {
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

    app.get(routePrefix+'/basket/list',  async (req, res) => {
        audit(req)

        postgresClient = await postgresPool.connect()
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
        postgresClient.release()  
    })
    app.post(routePrefix+'/basket/add',  async (req, res) => {
        audit(req)

        postgresClient = await postgresPool.connect()
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
        postgresClient.release()  
    })


    app.delete(routePrefix+'/basket/delete/:select(all|[0-9]+)',  async (req, res) => {
        audit(req)

        postgresClient = await postgresPool.connect()
        var selectValue = req.params.select
        
        var queryResult 
        switch(selectValue) {
            case "all": 
                queryResult =postgresClient.query(`DELETE FROM basket WHERE "userId" = $1`,[req.auth.login])
                break;
            default: 
                queryResult =postgresClient.query(`DELETE FROM basket WHERE "userId" = $1 AND id = $2`,[req.auth.login,selectValue])
        }
        queryResult.then(
            (dbResult) => {
                res.send({"status":"ok"})
            },
            (err) => {
                console.log("delete error "+err)
                res.status(403).send("internal error")
            } 
        )
        postgresClient.release()  
    })

    app.post(routePrefix+'/main/create',  async (req, res) => {
        audit(req)

        postgresClient = await postgresPool.connect()

        let orderName = timeStamp()
        //fake values for now so we don't have to deal with frontAddress
        let p = {
            user: req.auth.login,
            orderName: orderName,
            userName: req.body.name || req.auth.login,
            street: req.body.street || "Victory street",
            pobox: req.body.pobox || "1",
            city: req.body.city || "Racoon City",
            postcode: req.body.postcode || "100000",
            country: req.body.country || "United States"
        }
        let params = [p.user,p.orderName,p.userName,p.street,p.pobox,p.city,p.postcode,p.country]

        
        try {
            await postgresClient.query('BEGIN')
            var orderResult = await postgresClient.query(`INSERT INTO "order" ("userId","orderName","userName","street","PObox","city","postcode","country") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,"orderName";`,params)
            var orderId = orderResult.rows[0].id;
            var linesResult = await postgresClient.query(`INSERT INTO "orderItem" ("orderId","userId","catalogId","quantity","name","imgurl","price","totalPrice")
                     (SELECT $2,"userId","catalogId","quantity","name","imgurl","price",("quantity" * "price") FROM basket WHERE "userId" = $1) RETURNING *;`,[req.auth.login,orderId])
            
            
            const sum = linesResult.rows.reduce(
                (accumulator, currentValue) => accumulator + parseFloat(currentValue.totalPrice),
                0
            );
            var updResult = await postgresClient.query(`UPDATE "order" SET "totalPrice" = $1, "status" = $2 WHERE "userId" = $3 AND "id" = $4 RETURNING "id","orderName","totalPrice","status"`,[sum,"unpaid",req.auth.login,orderId])
            
            //cleanup if basket is processed to order
            await postgresClient.query(`DELETE FROM basket WHERE "userId" = $1`,[req.auth.login])
            
            await postgresClient.query('COMMIT')

            let packResult = {
                "status": "ok",
                "data": {
                    "id": updResult.rows[0].id,
                    "orderName": updResult.rows[0].orderName,
                    "totalPrice": updResult.rows[0].totalPrice,
                    "status": updResult.rows[0].status,
                    "items": linesResult.rows
                }
            }
            console.log("Order Logged",JSON.stringify(packResult).replace(/\n/g, ''))
            res.send(packResult)
        } catch (err) {
            await postgresClient.query('ROLLBACK')
            res.status(500).send("internal error creating order")
            console.log("Could not process creating order ",err)
        } finally {
            postgresClient.release()   
        }
            
    })

    app.post(routePrefix+'/main/pay/:orderId([0-9]+)',  async (req, res) => {
        audit(req)

        postgresClient = await postgresPool.connect()

        let orderId = req.params.orderId
        let userId = req.auth.login

        paymentDetails = {
            "K1SA":req.body.K1SA,
            "CVC":req.body.CVC
        }
        
        if (paymentDetails.K1SA && paymentDetails.CVC) {
            postgresClient.query(`SELECT "catalogId" AS "_id",(-"quantity") AS "inc" FROM "orderItem" WHERE "userId" = $1 AND "orderId" = $2`,[userId,orderId]).then(
                (itemsResult) => {
                    let packedUpdates = {updates:itemsResult.rows.map(u => { return {_id:u._id,inc:parseInt(u.inc)}})}
                    console.log("stock update because of payment processing",JSON.stringify(packedUpdates).replace(/\n/g, ''))
                    catalogUpdateStock("",packedUpdates).then(
                        (success) => {
                            postgresClient.query(`UPDATE "order" SET "status" = 'paid' WHERE "userId" = $1 AND "id" = $2 RETURNING "id","orderName","totalPrice","status"`,[req.auth.login,orderId]).then(
                                (success) => { res.status(200).send({"status":"ok"})},
                                (err) => { 
                                    res.status(500).send("internal error paying")
                                    console.log("Could not process payment ",err)
                                }
                            )
                        },
                        (err) => {
                            res.status(500).send("internal error paying")
                            console.log("Issues updating catalog ",err)
                        }
                    )
                },
                (err) => {
                    res.status(500).send("internal error paying")
                    console.log("Could not get order items ",err)
                }
            )
            
        } else {
            res.status(500).send("Couldn't find payment details, please provide K1SA and CVC in body")
        }

        postgresClient.release() 
    })

    app.get(routePrefix+'/main/list', async (req, res) => {
        audit(req)

        postgresClient = await postgresPool.connect()

        postgresClient.query(`SELECT "id","orderName" AS name,"status","totalPrice"  FROM "order" WHERE "userId" = $1`,[req.auth.login]).then(
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

        postgresClient.release()    

    })
 
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





