var crypto = require('crypto');
var fs = require('fs');

/**
 * md5 checksum from file 
 */
exports.md5hash = function(path, callback) {
    var md5sum = crypto.createHash('md5');
    var s = fs.createReadStream(path);

    s.on('data', function(d) {
        md5sum.update(d);
    });

    s.on('end', function() {
        d = md5sum.digest('base64')
        callback(null, d);
    });

    s.on('error', function(err) {
        callback(err);
    });
}

/*
this.md5hash(process.argv[2], function(err, md5) {
  if(err) 
		console.log(err);
	else
		console.log(md5);
});
*/
