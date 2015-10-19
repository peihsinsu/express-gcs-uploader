var fs = require('fs');
var multer = require('multer');
var gcloud = require('gcloud');
var log = require('nodeutil').simplelog;
var gcs;
var module_opts = {};
var sep = require('path').spe;

if(process.env.LOG_LEVEL) log.setLevel('TRACE');

exports.auth = function(opts) {
	if(!opts) throw "no auth configured...";
	if(!opts.projectId) throw "no project id....";
	if(!opts.keyFilename) throw "np keyFilename...";

  module_opts = opts;
	gcs = gcloud.storage({
		projectId: opts.projectId,
		keyFilename: opts.keyFilename
	});
}

exports.init = function(opts) {
	if(opts && !opts['onFileUploadComplete']) {
    opts['onFileUploadComplete'] = function(file, req, res) {
			if(module_opts.bucket) {
				log.trace('Saving data to google cloud storage...');
				var bucket = gcs.bucket(module_opts.bucket);
				var fileStream = fs.createReadStream(module_opts.rootdir + sep + file.path);
				fileStream.pipe(bucket.file(module_opts.keep_filename ? file.originalname : file.name).createWriteStream());

				if(module_opts.keep_filename) {
					log.trace('try to rename local filename from %s to %s',
							module_opts.rootdir + sep + module_opts.upload_url + sep + file.name,
              module_opts.rootdir + sep + module_opts.upload_url + sep + file.originalname);
          fs.rename(module_opts.rootdir + sep + module_opts.upload_url + sep + file.name, 
							module_opts.rootdir + sep + module_opts.upload_url + sep + file.originalname, function(err){
					   	if(err) log.error('rename file error:', err);
					})
				}
			}
		}
	}
  return (multer(opts));
}

exports.downloadproxy = function(req, res, next) {
	
  if(req.params.id) {
    if(module_opts.cdn_url) {
      res.redirect(module_opts.cdn_url + sep + req.params.id);
	  }
	 	if(fs.existsSync(module_opts.rootdir + sep + module_opts.upload_url + sep + req.params.id)) {
			log.trace('Using local file: %s', module_opts.rootdir + sep + module_opts.upload_url + sep + req.params.id);
		  var fileStream = fs.createReadStream(module_opts.rootdir + sep + module_opts.upload_url + sep + req.params.id);
			fileStream.pipe(res);
		} else {
			log.trace('Using gcs file');
			var bucket = gcs.bucket(module_opts.bucket);
			var fileStream = bucket.file(req.params.id).createReadStream();
			if(module_opts.cache) {
				log.trace('Caching file to %s',
						module_opts.rootdir + sep + module_opts.upload_url + sep + req.params.id);
				fileStream.pipe(fs.createWriteStream(
							module_opts.rootdir + sep + module_opts.upload_url + sep + req.params.id));
				fileStream.pipe(res);
			} else {
			  fileStream.pipe(res);
			}
		}
	} else {
    res.status(404).send('file not found!');
	}
}
