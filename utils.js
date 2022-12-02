function timeStamp() {
    var d = new Date()
    lz = (res) => { return res<10?"0"+res:""+res}//leadingzero 01 .. 09 10
    return d.toDateString()+" "+lz(d.getHours())+":"+lz(d.getMinutes())
}

function audit(req) {
    console.log("Request",req.auth.login,req.originalUrl)
}

module.exports = { timeStamp,audit }