var fs = require('fs')
  , multer = require('multer')
  , log = require('nodeutil').simplelog
  , module_opts = {}
	, sep = require('path').sep
	, mime = require('mime')
	, auth = require('google-api-utility')
  , request = auth.request
  , util = require('util')
  , fs = require('fs')
  , mkdirp = require('mkdirp');

//Default log level to debug
log.setLevel(process.env.LOG_LEVEL || 'DEBUG');

exports.auth = function(opts) {
	if(!opts) throw "no auth configured...";
	if(!opts.projectId) throw "no project id....";
	if(!opts.keyFilename) throw "np keyFilename...";

  module_opts = opts;
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
				uploadGcs(module_opts.bucket, 
						module_opts.rootdir + sep + file.path, 
						module_opts.keep_filename ? file.originalname : file.name,
						function(e,r,d){
						  if(e) log.error('upload GCS error: ', e);
							log.trace('upload file to GCS success: ', d);

							//Rename file process
							if(module_opts.keep_filename) {
								log.trace('try to rename local filename from %s to %s',
										module_opts.rootdir + module_opts.upload_url + sep + file.name,
										module_opts.rootdir + module_opts.upload_url + sep + file.originalname);

								fs.rename(module_opts.rootdir + module_opts.upload_url + sep + file.name, 
									module_opts.rootdir + module_opts.upload_url + sep + file.originalname, 
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
	var path = req.originalUrl;
	var patharr = path.split('/');
	patharr.shift();
	patharr.shift()

	path = patharr.join('/');

	req.params.id = path;
	log.trace('Download proxy: ', req.params.id);

  if(req.params.id) {
		//If CDN setting is true, using CDN directly
    if(module_opts.cdn_url) {
			log.trace('response from cdn url: ', module_opts.cdn_url + sep + req.params.id);
      return res.redirect(module_opts.cdn_url + sep + req.params.id);
	  }

	  log.trace('Checking path: %s, result:%s', 
			module_opts.rootdir + module_opts.upload_url + sep + req.params.id,
			fs.existsSync(module_opts.rootdir + module_opts.upload_url + sep + req.params.id));

		//If local file exist, using local response
		if(fs.existsSync(module_opts.rootdir + module_opts.upload_url + sep + req.params.id)) {
			log.trace('Using local file: %s', module_opts.rootdir + module_opts.upload_url + sep + req.params.id);
		  var fileStream = fs.createReadStream(module_opts.rootdir + module_opts.upload_url + sep + req.params.id);
			fileStream.pipe(res);
		} 
		
		//If no CDN, no local, then use GCS for response
		else {
			log.trace('Using gcs file...');

			getDownloadInfo(module_opts.bucket, encodeURIComponent(req.params.id), function(e,r,d){
				if(module_opts.cache) {
					log.trace('Caching file to %s',
							module_opts.rootdir + module_opts.upload_url + sep + req.params.id);

					if(e) {
						log.error('Get metadata error:', e);
					}

					log.info("got result:", d);
					log.info("got result type:", typeof(d));

					if(!d) {
						log.info('do sent...');
						return res.status(404).send({"code": 404, "msg": "file not found"});
					} 

					if(typeof(d) != 'object') d = JSON.parse(d);

					log.info('do else...');

					if(!d['mediaLink']) {
						log.error("response api not correct, d=", d);
						return res.status(404).send({"code": 404, "msg": "response api not correct"});
					}

					//Checking and create path folder
					var path = module_opts.rootdir + module_opts.upload_url + sep + req.params.id;
					var tmpArr = path.split('/');
					tmpArr.pop()
					var fpath = tmpArr.join('/');
					log.trace('mkdir for %s', fpath);
					mkdirp.sync(fpath);

				  //Download from GCS and also sync to folder	
					auth.requestDownload({
						url: d.mediaLink,
						method: 'GET'
					},
				  path,	
					function(request){
						log.trace('Start to process download and response....');
						request.pipe(res).pipe(fs.createWriteStream(path));
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
	log.trace('Get from GCS bucket:%s, filename:%s', bucket, filename);
  var downloadUrl = 'https://www.googleapis.com/storage/v1/b/%s/o/%s';
	request({
		url: util.format(downloadUrl, bucket, filename),
		method: 'GET'
	}, callback);
}
