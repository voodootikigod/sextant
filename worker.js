var sys = require("sys");
var fs = require("fs");
var http = require("http");
var couchdb = require("couchdb").createClient(5984, "localhost");
var db = couchdb.db("arewefirstyet");



var target_queries = [
    {name: "Learn JavaScript", query: "Learn%20JavaScript", target: "developer.mozilla.org"}
];
var target_url = "/ajax/services/search/web?v=1.0&q={QUERY}&start={PAGE}"
var MAX_PAGES = 10;

var get_page_results = function (target_url, page, callback) {
    var google = http.createClient(80, "ajax.googleapis.com");
    var request = google.request('GET', 
                                 target_url,
                                 {
                                     "Host": "ajax.googleapis.com",
                                     "User-Agent": "Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US) AppleWebKit/525.13 (KHTML, like Gecko) Chrome/0.A.B.C Safari/525.13"
                                 });
    request.end();
    request.on("response", function (response) {
        var body = "";
        response.on("data", function(chunker) {
            body += chunker;
        });
        response.on("end", function() { 
            var data = JSON.parse(body);



            var urls = [];
            var juicybits = data.responseData.results;
            
            for (var bitcount in juicybits) {
                var bit = juicybits[bitcount];
                urls.push({url: bit.url, name: bit.titleNoFormatting})
            }
            callback(urls);
        });
	       
    });
}
function pad(n){return n<10 ? '0'+n : n}

function post_results(target, rankings) {
    var nao = (new Date());
    
    var timestamp = ""+nao.getFullYear()+pad(nao.getUTCMonth())+pad(nao.getUTCDate())
    var placement = 100;
    for (var idx =0; idx < rankings.length; idx++) {
        if (rankings[idx].url.indexOf(target.target) >= 0 && placement > idx) {
            placement = idx;
        }
    }

    db.saveDoc(timestamp, {"target": target.name, "query": target.query, "placement": placement, "rankings": rankings}, function (err, doc) {
        if (err) { throw new Error(JSON.stringify(err)) }
    });
}

for (var idx in target_queries) {
    var target = target_queries[idx];
    var results = [];
    var page_count = 0;
    var completed = 0;
    for (page_count = 0; page_count < MAX_PAGES; page_count++) {
        var cb = (function (t, pc) {
            return function(urls) {
                results[pc] =  urls;
                completed += 1;
                if (completed == MAX_PAGES) {
                    
                    post_results(t, results.reduce(function(a,b) {
                        return a.concat(b) 
                    }, []));
                }
            };
        })(target, page_count);
	var tu = target_url.replace("{QUERY}", target.query).replace("{PAGE}", ""+(page_count*4));
        get_page_results(tu, page_count, cb);

    }

    
}
    

