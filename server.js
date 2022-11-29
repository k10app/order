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


function timeStamp() {
    var d = new Date()
    lz = (res) => { return res<10?"0"+res:""+res}//leadingzero 01 .. 09 10
    return d.toDateString()+" "+lz(d.getHours())+":"+lz(d.getMinutes())
}

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
                console.log(params)
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

    app.get(routePrefix+'/basket/delete/:select(all|[0-9]+)',  async (req, res) => {
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
        
    })

    app.post(routePrefix+'/main/create',  async (req, res) => {
        let orderName = timeStamp()
        let params = [req.auth.login,orderName,req.body.name,req.body.street,req.body.pobox,req.body.city,req.body.postcode,req.body.country]

        postgresClient.query(`INSERT INTO "order" ("userId","orderName","userName","street","PObox","city","postcode","country") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,"orderName";`,params).then(
                (orderResult)=> {
                    var orderId = orderResult.rows[0].id;

                    postgresClient.query(`INSERT INTO "orderItem" ("orderId","userId","catalogId","quantity","name","imgurl","price")
                     (SELECT $2,"userId","catalogId","quantity","name","imgurl","price" FROM basket WHERE "userId" = $1);`,[req.auth.login,orderId]).then(
                        (copyResult) => {
                            res.send({
                                "status":"success",
                                "id":orderId,
                                "name":orderResult.rows[0].orderName
                            })
                        },
                        (err)=> {
                            console.log(err)
                            res.status(403).send("internal error")
                        }
                     )
                },
                (err)=> {
                    console.log(err)
                    res.status(403).send("internal error")
                }
             )
    })

    app.get(routePrefix+'/main/list', async (req, res) => {
        postgresClient.query(`SELECT "id","orderName" AS name FROM "order" WHERE "userId" = $1`,[req.auth.login]).then(
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
 
    app.get(routePrefix+'/main/list/:orderId([0-9]+)', async (req, res) => {
        let orderId = req.params.orderId
        let userId = req.auth.login

        postgresClient.query(`SELECT "id","orderName" FROM "order" WHERE "userId" = $1 AND "id" = $2`,[userId,orderId]).then(
            (queryResult) => {
                if(queryResult.rowCount == 0) {
                    res.send({})
                } else {
                    postgresClient.query(`SELECT * FROM "orderItem" WHERE "userId" = $1 AND "orderId" = $2`,[userId,orderId]).then(
                        (itemQueryResult)=> {
                            var orderObject = function(id,name,items) {
                                return {id:orderId,name:name,items:items}
                            }
                            if(queryResult.rowCount == 0) {
                                res.send(orderObject(queryResult.rows[0].id,queryResult.rows[0].orderName,[]))
                            } else {
                                res.send(orderObject(queryResult.rows[0].id,queryResult.rows[0].orderName,itemQueryResult.rows))
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
        "orderName" text,
        "userName" text,
        "street" text,
        "PObox" text,
        "city" text,
        "postcode" text,
        "country" text,
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





