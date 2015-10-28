var App = function (options){

	var websocket = null;


	var Models= {};
	var Collections = {};
	var Views = {};


	var init = function (){
		connectWebsocket();
		initBackbone();
		initHighcharts();
	};

	var initHighcharts = function () {
		Highcharts.setOptions({
			global: {
				useUTC: false
			},
			plotOptions: {
				spline: {
					connectNulls: true
				}
			}
		});
	}

	var connectWebsocket = function (){
		websocket = new WebSocket("ws://" + location.host + '/admin');
		websocket.onopen = function (evt) {
			console.log("websocket connected");
		};

		websocket.onerror = function (evt) {
			console.log("websocket error:", evt.data);
		};

		websocket.onclose = function(evt) {
			// reconnect on close
			setTimeout(connectWebsocket, 5000);
		};

		websocket.onmessage = function(event) {
			// console.log(event.data);
			incomingSocketData(JSON.parse(event.data));
		};

	};

	function incomingSocketData (data) {
		console.log(data);


		if(data.message == 'device_registration') {
			var phone = data;

			console.log('new phone connected');

			// check if phone is already known:
			var phoneModel = Collections.phones.get(phone.client_id);
			if(!phoneModel){
				// add new phone to backbone collection:
				Collections.phones.add(phone);
			}else{
				phoneModel.set('connected', true);
			}

			return;
		}


		if(data.message == 'disconnect') {
			var phoneModel = Collections.phones.get(data.client_id);
			if(!phoneModel) return console.log('no phone with client_id "' + phoneModel + '" found.');

			phoneModel.set('connected', false);

			return;
		}

		if(data.message == 'preview_frame') {
			var phoneModel = Collections.phones.get(data.client_id);
			if(!phoneModel) return console.log('no phone with client_id "' + phoneModel + '" found.');

			phoneModel.set('preview_frame', data.url);
			return;
		}

		if(data.status) {
			var phoneModel = Collections.phones.get(data.client_id);
			if(!phoneModel) return console.log('no phone with client_id "' + phoneModel + '" found.');

			phoneModel.set('status', data.status);

			if(data.status == 'UPLOADING' || data.status == 'UPLOADED') {
				phoneModel.set('isTransferingBytes', true);
				phoneModel.set('bytesTransferred', data.bytesTransferred);
			}

			return;
		}
	};

	function initBackbone (){
		Collections.phones = new Collections.Phones();
		new Views.Phones({collection: Collections.phones});
		Collections.phones.add(options.connectedPhones);
	};


	// BACKBONE:
	// ======================


	// MODELS AND COLLECTIONS:
	// ======================


	Models.Phone = Backbone.Model.extend({
		idAttribute: 'client_id',

		initialize: function (options) {
			this.on('change:bytesTransferred', this.calculateSpeed, this);
		},

		defaults:{
			connected: true,
			bytesTransferred: -1,
			status: 'IDLE',
			isRecording: false,
			isTransferingBytes: false,
			speed: 0
		},

		calculateSpeed: function (bytesTransferred) {
			console.log('calculating speed');

			var now = Date.now();

			if(this.get('isTransferingBytes') && this.get('bytesTransferred') != 0) {
				var deltaBytes = this.get('bytesTransferred') - this.previous('bytesTransferred');
				var deltaSeconds = (now - this.get('lastSpeedCalculation'))/1000;

				console.log('lastSpeedCalculation', this.get('lastSpeedCalculation'));

				var bytesPerSecond = deltaBytes/deltaSeconds;
				var kiloBytesPerSecond = bytesPerSecond/1024;
				var megabitPerSecond = (kiloBytesPerSecond/1024)*8;

				console.log('megabitPerSecond', megabitPerSecond);

				this.set('megabitPerSecond', megabitPerSecond);
			}


			this.set('lastSpeedCalculation', now);

			if(this.get('status') == 'UPLOADED') {
				this.set('isTransferingBytes', false);
				this.set('bytesTransferred', -1);
			}
		},

		sendToPhone: function (data) {
			data.client_id = this.get('client_id');
			console.log('sending data over socket:', data);
			websocket.send(JSON.stringify(data));
		}
	});

	Collections.Phones = Backbone.Collection.extend({
		model: Models.Phone
	});



	// VIEWS:
	// ======================

	Views.Phones = Backbone.View.extend({
		el: '.phones',

		views: [],

		initialize: function () {
			this.collection.on('add', this.addPhoneView, this);
		},

		addPhoneView: function (model) {
			var view = new Views.Phone({model: model});

			// append view to me:
			this.$el.append( view.render().el );

			// render chart AFTER it's been added to the DOM:
			view.renderSpeedChart();

			// store view object for later (removal when sorting):
			this.views.push(view);
		}
	});

	Views.Phone = Backbone.View.extend({
		template: '#phone-tmpl',
		className: 'phone',

		graphMaxSamplesVisible: 20,
		currentNoOfGraphSamples: 0,

		initialize: function () {
			this.listenTo(this.model, 'change:connected', this.renderVisibility);
			this.listenTo(this.model, 'change:preview_frame', this.renderPreviewFrame);
			this.listenTo(this.model, 'change:status', this.renderStatus)
			this.listenTo(this.model, 'change:isRecording', this.renderIsRecording);
			this.listenTo(this.model, 'change:megabitPerSecond', this.renderSpeed);

			this.updateChartWithSpeedZero();
		},

		events : {
			'click .recordbutton'          : 'recordbutton_clicked',
			'click button.fetchlog'        : 'fetchlog_clicked',
			'click button.deletephonedata' : 'deletephonedata_clicked',
			'change select.disablewifi'    : 'disablewifi_changed'
		},

		render: function(){
			var html = $(this.template).tmpl(this.model.toJSON());
			this.$el.html(html);
			this.renderVisibility();
			this.renderStatus();
			this.renderIsRecording();
			return this;
		},

		renderVisibility: function () {
			if(this.model.get('connected')) {
				this.$el.show();
				this.$el.removeClass('disconnected');
			}else{
				this.$el.addClass('disconnected');
				var $view = this.$el;
				setTimeout(function () {
					$view.hide();
				}, 1000);

			}
		},

		renderPreviewFrame: function () {
			if(this.model.get('preview_frame')) {
				this.$('.preview_frame').css('background-image', 'url("'+ this.model.get('preview_frame') +'")')
			}
		},


		renderStatus: function () {
			switch(this.model.get('status')) {

				case 'REC':
				this.$('.statetext').text('recording');
				this.model.set('isRecording', true);
				break;

				case 'UPLOADING':
				this.$('.statetext').text('uploading');
				break;

				default:
				this.$('.statetext').text('idle');
				this.model.set('isRecording', false);
				break;
			}
		},


		renderIsRecording: function () {
			if(this.model.get('isRecording')) {
				this.$('.uploadspeed').text('');
				this.$el.addClass('recording');
			}else{
				this.$el.removeClass('recording');
			}
		},

		renderSpeed: function () {
			var speed = this.model.get('megabitPerSecond');
			var unit = 'mbps';


			if(Math.floor(speed) == 0){
				speed = speed * 1024;
				unit = 'kbps';
			}

			if(Math.floor(speed) == 0){
				speed = speed * 1024;
				unit = 'bps';
			}


			var text = Math.round(speed*100)/100 + ' ' + unit;
			this.$('.uploadspeed').text(text);


			// add to graph:
			var x = Date.now();
			var y = this.model.get('megabitPerSecond') * 1024 * 1024; // bps
			this.addPointToGraph(x, y);
		},

		renderSpeedChart: function () {
			var thisView = this;

			this.$('.chart').highcharts({
				chart: {
					type: 'spline',
					animation: Highcharts.svg, // don't animate in old IE
					marginRight: 10,
					events: {
						load: function() {
							thisView.graphSeries = this.series[0];

							// set up the updating of the chart each second
							// var series = this.series[0],
							// 	maxSamples = 20,
							// 	count = 0;
							// setInterval(function() {
							// 	var x = (new Date()).getTime(), // current time
							// 		y = Math.random();
							// 	series.addPoint(
							// 		[x,y]
							// 		, true
							// 		, (++count >= maxSamples)
							// 	);
							// }, 1000);
						}
					}
				},
				title: {
					text: thisView.model.get('device')
				},
				xAxis: {
					type: 'datetime',
					tickPixelInterval: 150
				},
				yAxis: {
					title: {
						text: 'speed'
					},
					plotLines: [{
						value: 0,
						width: 1,
						color: '#808080'
					}]
				},

				legend: {
					enabled: false
				},
				exporting: {
					enabled: false
				},
				series: [{
					name: 'speed',
					 data: (function() {
					// generate an array of 0's te 'emulate' the 20 previous values
					var data = [],
						time = (new Date()).getTime(),
						i;

					for (i = -(thisView.graphMaxSamplesVisible-1); i <= 0; i++) {
						data.push({
							x: time + i * 1000,
							y: 0
						});
					}
					return data;
				})()
				}],
				tooltip: {
					enabled: false
				},
				plotOptions: {
					series: {
						marker: {
							enabled: false
						}
					}
				},
			});
		},

		addPointToGraph: function (x, y) {
			if(!this.graphSeries) return;

			this.currentNoOfGraphSamples++;

			var moveGraph = false;
			if(this.currentNoOfGraphSamples > this.graphMaxSamplesVisible) {
				moveGraph = true;
			}

			this.graphSeries.addPoint([x,y], true, moveGraph);
		},

		updateChartWithSpeedZero: function () {
			// console.log('updateChartWithSpeedZero');

			if(!this.model.get('isTransferingBytes')) {
				var x = Date.now();
				var y = 0;
				this.addPointToGraph(x,y);
			}

			var self = this;
			setTimeout(function () {
				self.updateChartWithSpeedZero.apply(self);
			},1000);
		},

		recordbutton_clicked: function (event) {
			if(this.model.get('isRecording')) return console.log('Already recording');

			this.model.sendToPhone({
				toggleRecord: "1"
			});

			// set isRecording so you can't record twice:
			this.model.set('isRecording', true);
		},

		fetchlog_clicked: function (event) {
			this.model.sendToPhone({
				postLog: "1"
			});
		},

		deletephonedata_clicked: function (event) {
			this.model.sendToPhone({
				wipeVideos: "1"
			});
		},

		disablewifi_changed: function  (event) {
			var time = this.$('select.disablewifi').val();
			if(time){
				this.$('select.disablewifi').val(0); //reset dropdown

				this.model.sendToPhone({
					reconnectIn: time
				});
			}
		}

	});





	return {
		init: init
	};
};


