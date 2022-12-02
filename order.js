const { timeStamp,audit } = require("./utils.js");

class Order {
    constructor(postgresPool,catalogUpdateStockFunc) {
        this.postgresPool = postgresPool;  
        this.audit = audit;
        this.timeStamp = timeStamp;
        this.catalogUpdateStock = catalogUpdateStockFunc
        
        this.funcNames = ["create","pay","list","listDetails","delete"]
        this.funcNames.forEach(funcName => {
            this[funcName] = this[funcName].bind(this)
        });
    }

    async create(req, res) {
       this.audit(req)

       
        postgresClient = await this.postgresPool.connect()

        let orderName = this.timeStamp()
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
            
    }


    async pay(req, res) {
        this.audit(req)

        postgresClient = await this.postgresPool.connect()

        let orderId = req.params.orderId
        let userId = req.auth.login

        let paymentDetails = {
            "K1SA":req.body.K1SA,
            "CVC":req.body.CVC
        }
        
        if (paymentDetails.K1SA && paymentDetails.CVC) {
            postgresClient.query(`SELECT "catalogId" AS "_id",(-"quantity") AS "inc" FROM "orderItem" WHERE "userId" = $1 AND "orderId" = $2`,[userId,orderId]).then(
                (itemsResult) => {
                    let packedUpdates = {updates:itemsResult.rows.map(u => { return {_id:u._id,inc:parseInt(u.inc)}})}
                    console.log("stock update because of payment processing",JSON.stringify(packedUpdates).replace(/\n/g, ''))
                    this.catalogUpdateStock("",packedUpdates).then(
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
    }


    async list(req, res) {
        this.audit(req)

        postgresClient = await this.postgresPool.connect()

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

    }

    async listDetails (req, res) {
        this.audit(req)

        postgresClient = await this.postgresPool.connect()

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
    }
    async delete (req, res) {
            this.audit(req)
    
            postgresClient = await this.postgresPool.connect()
    
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
            
        
    }
}

module.exports = { Order }