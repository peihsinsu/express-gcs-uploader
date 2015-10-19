var fs = require('fs');
var multer = require('multer');
//var gcloud = require('gcloud');
var log = require('nodeutil').simplelog;
// var gcs;
var module_opts = {};
var sep = require('path').sep;
var mime = require('mime');
var auth = require('google-api-utility')
  , request = auth.request
  , util = require('util')
  , fs = require('fs')

//if(process.env.LOG_LEVEL) log.setLevel('TRACE');

exports.auth = function(opts) {
	if(!opts) throw "no auth configured...";
	if(!opts.projectId) throw "no project id....";
	if(!opts.keyFilename) throw "np keyFilename...";

  module_opts = opts;
	// gcs = gcloud.storage({
	// 	projectId: opts.projectId,
	// 	keyFilename: opts.keyFilename
	// });
	auth.init({
	  scope: 'https://www.googleapis.com/auth/devstorage.full_control https://www.googleapis.com/auth/devstorage.read_write https://www.googleapis.com/auth/cloud-platform',
	  json_file: opts.keyFilename
	});
}

exports.init = function(opts) {
	if(opts && !opts['onFileUploadComplete']) {
    opts['onFileUploadComplete'] = function(file, req, res) {
			if(module_opts.bucket) {
				log.trace('Saving data to google cloud storage...');
				/*
				var bucket = gcs.bucket(module_opts.bucket);
				var fileStream = fs.createReadStream(module_opts.rootdir + sep + file.path);
				fileStream.pipe(bucket.file(module_opts.keep_filename ? file.originalname : file.name).createWriteStream());
				*/
				uploadGcs(module_opts.bucket, 
						module_opts.rootdir + sep + file.path, 
						module_opts.keep_filename ? file.originalname : file.name,
						function(e,r,d){
						  if(e) log.error('upload GCS error: ', e);
							log.trace('upload file to GCS success: ', d);

							//Rename file process
							if(module_opts.keep_filename) {
								log.trace('try to rename local filename from %s to %s',
										module_opts.rootdir + sep + module_opts.upload_url + sep + file.name,
										module_opts.rootdir + sep + module_opts.upload_url + sep + file.originalname);

								fs.rename(module_opts.rootdir + sep + module_opts.upload_url + sep + file.name, 
									module_opts.rootdir + sep + module_opts.upload_url + sep + file.originalname, 
									function(err){
											if(err) log.error('rename file error:', err);
								});
							}
						}
					);

				
			}
		}
	}
  return (multer(opts));
}

exports.downloadproxy = function(req, res, next) {
  if(req.params.id) {
    if(module_opts.cdn_url) {
			log.trace('response from cdn url: ', module_opts.cdn_url + sep + req.params.id);
      res.redirect(module_opts.cdn_url + sep + req.params.id);
	  }
	 	if(fs.existsSync(module_opts.rootdir + sep + module_opts.upload_url + sep + req.params.id)) {
			log.trace('Using local file: %s', module_opts.rootdir + sep + module_opts.upload_url + sep + req.params.id);
		  var fileStream = fs.createReadStream(module_opts.rootdir + sep + module_opts.upload_url + sep + req.params.id);
			fileStream.pipe(res);
		} else {
			log.trace('Using gcs file');

			//var bucket = gcs.bucket(module_opts.bucket);
			//var fileStream = bucket.file(req.params.id).createReadStream();
			getDownloadInfo(module_opts.bucket, req.params.id, function(e,r,d){
				if(module_opts.cache) {
					log.trace('Caching file to %s',
							module_opts.rootdir + sep + module_opts.upload_url + sep + req.params.id);
					if(typeof(d) != 'object') d = JSON.parse(d);

					auth.requestDownload({
						url: d.mediaLink,
						method: 'GET'
					}, 
					module_opts.rootdir + sep + module_opts.upload_url + sep + req.params.id , 
					function(e,r,d){
				    if(e) 
							log.error('request gcs file error...');
						res.pipe(
							fs.createReadStream(module_opts.rootdir + sep + module_opts.upload_url + sep + req.params.id));	
					});
				}
			});
			
		}
	} else {
    res.status(404).send('file not found!');
	}
}

function uploadGcs(bucket, filepath, finalname, callback) {
	log.trace('Upload info: bucket=%s, filepath=%s, finalname=%s', bucket, filepath, finalname);
  request({
		url: util.format('https://www.googleapis.com/upload/storage/v1/b/%s/o', bucket),
	  method: 'POST',
	  preambleCRLF: true,
	  postambleCRLF: true,
	  multipart: [
	    { 'Content-Type':'application/json', body: JSON.stringify({name: finalname}) },
	    { 'Content-Type': mime.lookup(filepath), body: fs.readFileSync(filepath) }
	  ]
	}, callback);
}

function getDownloadInfo(bucket, filename, callback) {
  var downloadUrl = 'https://www.googleapis.com/storage/v1/b/%s/o/%s';
	request({
		url: util.format(downloadUrl, bucket, filename),
		method: 'GET'
	}, callback);
}
