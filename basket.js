const { audit } = require("./utils.js");

class Basket {
    constructor(postgresPool,catalogGetItemFunc) {
        this.postgresPool = postgresPool; 
        this.audit = audit;
        this.catalogGetItem = catalogGetItemFunc
        

        //https://stackoverflow.com/questions/47290709/getting-an-undefined-this-when-using-classes-async-await
        this.funcNames = ["add","list","delete"]
        this.funcNames.forEach(funcName => {
            this[funcName] = this[funcName].bind(this)
        });
    }
    
    async list(req, res)  {
        this.audit(req) 

        postgresClient = await this.postgresPool.connect()
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
    }

    async add(req, res) {
        this.audit(req)

        let quantity = parseInt(req.body.quantity || 0)
        if (quantity < 1) {
            res.status(403).send("quantity should be greater or equal to 1 got "+quantity)
        } else {
            postgresClient = await this.postgresPool.connect()
            let catalogId = ""+req.body.catalogId
            let login = req.auth.login
            

            postgresClient.query(`SELECT "quantity" FROM basket WHERE  "userId" = $1 AND "catalogId" = $2`,[login,catalogId]).then(
                (queryResult)=> {
                    if(queryResult.rowCount == 0) {
                        this.catalogGetItem(catalogId).then(
                            (RESTResult) => {
                                let params = [login,catalogId,quantity,RESTResult.name,RESTResult.imgurl,RESTResult.price]
                                
                                postgresClient.query(`INSERT INTO basket ("userId","catalogId","quantity","name","imgurl","price") VALUES ($1,$2,$3,$4,$5,$6)`,params).then(
                                    (queryResult)=> {
                                        res.send({"status":"success"})
                                    },
                                    (err) => {
                                        console.log(err)
                                        res.status(500).send("internal error")
                                    }
                                )
                            },
                            (err) => {
                                console.log("catalog query error "+err)
                                res.status(500).send("invalid catalog id "+catalogId)
                            }
                        )
                    } else {
                        postgresClient.query(`UPDATE basket SET "quantity" = $3 WHERE  "userId" = $1 AND "catalogId" = $2 `,[login,catalogId,(quantity+parseInt(queryResult.rows[0].quantity))]).then(
                            (queryResult)=> {
                                res.send({"status":"success"})
                            },
                            (err) => {
                                console.log(err)
                                res.status(500).send("internal error")
                            }
                        )
                    }
                    
                },
                (err) => {
                    console.log(err)
                    res.status(500).send("internal error")
                }
            )

            postgresClient.release()  
        }

    }
    async delete(req, res) {
        this.audit(req)

        postgresClient = await this.postgresPool.connect()
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
    }
}
module.exports = { Basket } 