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
				phoneModel.set('isInForeground', true);
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

		if(data.message == 'log') {
			var phoneModel = Collections.phones.get(data.client_id);
			if(!phoneModel) return console.log('no phone with client_id "' + phoneModel + '" found.');

			phoneModel.set('log', phoneModel.get('log') + data.content + "<br \>");

			return;
		}

		if(data.message == 'recordingtime') {
			var phoneModel = Collections.phones.get(data.client_id);
			if(!phoneModel) return console.log('no phone with client_id "' + phoneModel + '" found.');

			phoneModel.set('recordingtime', data.timeString);

			return;
		}

		if(data.message == 'isInForegroundChanged') {
			var phoneModel = Collections.phones.get(data.client_id);
			if(!phoneModel) return console.log('no phone with client_id "' + phoneModel + '" found.');

			phoneModel.set('isInForeground', data.isInForeground);

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

		new Views.CommonControls();
	};


	// BACKBONE:
	// ======================


	// MODELS AND COLLECTIONS:
	// ======================


	Models.Phone = Backbone.Model.extend({
		idAttribute: 'client_id',

		inActiveTimer: null,

		initialize: function (options) {
			this.on('change:bytesTransferred', this.calculateSpeed, this);
			this.on('change', this.somethingChanged, this);

			this.somethingChanged();
		},

		defaults:{
			appVersion: "1.0.1",
			operatingSystem: "",
			operatingSystemVersion: "",
			carrierName: "",
			connected: true,
			bytesTransferred: -1,
			status: 'IDLE',
			isRecording: false,
			isTransferingBytes: false,
			speed: 0,
			log: "",
			isInForeground: true,
			active: true
		},

		somethingChanged: function () {
			if (this.hasChanged("active")) return;

			this.set('active', true);

			var self = this;

			if(this.inActiveTimer) {
				clearTimeout(this.inActiveTimer);
				this.inActiveTimer = null;
			}
			this.inActiveTimer = setTimeout(function () {
				self.set('active', false);
			}, 20000);
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

				if (!isNaN(megabitPerSecond))
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


	Views.CommonControls = Backbone.View.extend({
		el: '.commoncontrols',

		events : {
			'click .recordAll'                      : 'recordAll_clicked'
		},

		recordAll_clicked: function (event) {
			Collections.phones.each(function (phoneModel) {
				phoneModel.sendToPhone({
					toggleRecord: "1"
				});
				phoneModel.set('isRecording', true);
			});
		}
	});

	Views.Phones = Backbone.View.extend({
		el: '.phones',

		views: [],

		initialize: function () {
			this.listenTo(this.collection, 'add', this.addPhoneView, this);
			this.listenTo(this.collection, 'change:connected', this.updateNrOfPhonesConnected);
			this.listenTo(this.collection, 'change:active', this.updateNrOfPhonesActive);
		},

		addPhoneView: function (model) {
			var view = new Views.Phone({model: model});

			// append view to me:
			this.$el.append( view.render().el );

			// render chart AFTER it's been added to the DOM:
			view.renderSpeedChart();

			view.hideHighChartsText();

			// store view object for later (removal when sorting):
			this.views.push(view);

			this.updateNrOfPhonesConnected();
			this.updateNrOfPhonesActive();
		},

		updateNrOfPhonesConnected: function () {
			var nrOfPhonesConnected = 0;
			this.collection.forEach(function (model) {
				if(model.get('connected')) {
					nrOfPhonesConnected++;
				}
			});
			if(nrOfPhonesConnected == 1){
				$('.phonesconnected').text(nrOfPhonesConnected + ' phone connected');
			}else{
				$('.phonesconnected').text(nrOfPhonesConnected + ' phones connected');
			}
		},

		updateNrOfPhonesActive: function () {
			var nrOfPhonesActive = 0;
			this.collection.forEach(function (model) {
				if(model.get('active')) {
					nrOfPhonesActive++;
				}
			});
			if(nrOfPhonesActive == 1){
				$('.phonesactive').text(nrOfPhonesActive + ' phone active');
			}else{
				$('.phonesactive').text(nrOfPhonesActive + ' phones active');
			}
		},
	});

	Views.Phone = Backbone.View.extend({
		template: '#phone-tmpl',
		className: 'phone',

		graphMaxSamplesVisible: 20,
		currentNoOfGraphSamples: 0,

		initialize: function () {
			this.listenTo(this.model, 'change:connected', this.renderVisibility);
			this.listenTo(this.model, 'change:isInForeground', this.renderIsInForeground);

			this.listenTo(this.model, 'change:preview_frame', this.renderPreviewFrame);
			this.listenTo(this.model, 'change:status', this.renderStatus)
			this.listenTo(this.model, 'change:isRecording', this.renderIsRecording);
			this.listenTo(this.model, 'change:megabitPerSecond', this.renderSpeed);

			this.listenTo(this.model, 'change:log', this.renderLog);
			this.listenTo(this.model, 'change:recordingtime', this.renderRecordingtime);

			this.listenTo(this.model, 'change:username', this.renderUsername);
			this.listenTo(this.model, 'change:active', this.renderActive);


			this.updateChartWithSpeedZero();
		},

		events : {
			'click .recordbutton'                      : 'recordbutton_clicked',

			'click .previewimage'                      : 'previewimage_clicked',

			'click button.fetchlog'                    : 'fetchlog_clicked',
			'click button.deletephonedata'             : 'deletephonedata_clicked',
			'change select.disablewifi'                : 'disablewifi_changed',

			'click button.sayEnglishText'              : 'sayEnglishText_clicked',
			'click button.sayDutchText'                : 'sayDutchText_clicked',

			'click button.toggleCamera'                : 'toggleCamera_clicked',
			'click button.toggleSevenSecondsMode'      : 'toggleSevenSecondsMode_clicked',

			'click .log>.delete'   	                   : 'deleteLog_clicked',
			'click button.sendAlertmessage'            : 'sendAlertmessage_clicked',

			'click button.moreactions'                 : 'moreactions_clicked',
			'click button.lessactions'                 : 'lessactions_clicked',

			'click button.killApp'                     : 'killApp_clicked',

			'click .info>.moreinfo'                    : 'moreinfo_clicked',
			'click .info>.moreinfo>.username>input'    : 'usernameTextfield_clicked',
			'keypress .info>.moreinfo>.username>input' : 'usernameTextfield_keypressDetected',


		},

		render: function(){
			var html = $(this.template).tmpl(this.model.toJSON());
			this.$el.html(html);
			this.renderVisibility();
			this.renderStatus();
			this.renderIsRecording();
			this.renderIsInForeground();
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

		renderActive: function () {
			if(this.model.get('active')){
				this.$el.removeClass('inactive');
			}else{
				this.$el.addClass('inactive');
			}
		},

		renderIsInForeground: function () {
			if(this.model.get('isInForeground')) {
				this.$el.removeClass('isBackground');
			}else{
				this.$el.addClass('isBackground');
			}
		},

		renderPreviewFrame: function () {
			if(this.model.get('preview_frame')) {
				this.$('.previewimage').css('background-image', 'url("'+ this.model.get('preview_frame') +'")')
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

		renderLog: function () {
			this.$('.log>.content').html(this.model.get('log'));

			// scroll down:
			this.$('.log>.content')[0].scrollTop = this.$('.log>.content')[0].scrollHeight;
		},

		renderRecordingtime: function () {
			this.$('.statetext').text(this.model.get('recordingtime'));
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
					text: null
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

		hideHighChartsText: function () {
			this.$("text[x=290]").hide();
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

		renderUsername: function () {
			this.$('.info>.moreinfo>.username>.value').text(this.model.get('username'));
		},

		recordbutton_clicked: function (event) {
			if( !this.model.get('isRecording')) {
				this.model.sendToPhone({
					toggleRecord: "1"
				});

				this.model.set('isRecording', true);
			}else{
				this.model.sendToPhone({
					toggleRecord: "0"
				});

				this.model.set('isRecording', false);
			}
		},

		previewimage_clicked: function (event) {
			if(this.model.get('preview_frame')) {
				window.open(this.model.get('preview_frame'), '_blank');
			}
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
		},

		sayEnglishText_clicked: function (event) {
			this.model.sendToPhone({
				message: 'fun',
				sayEnglishText: this.$('input.englishText').val()
			});
		},

		sayDutchText_clicked: function (event) {
			this.model.sendToPhone({
				message: 'fun',
				sayDutchText: this.$('input.dutchText').val()
			});
		},

		toggleCamera_clicked: function (event) {
			this.model.sendToPhone({
				toggleCamera: 1
			});
		},

		deleteLog_clicked: function (event) {
			this.model.set('log', '');
		},

		toggleSevenSecondsMode_clicked: function (event) {
			this.model.sendToPhone({
				toggleSevenSecondsMode: 1
			});
		},

		sendAlertmessage_clicked: function (event) {
			this.model.sendToPhone({
				alertmessage: this.$('input.alertmessage').val()
			});
		},

		moreactions_clicked: function (event) {
			this.$('.actions>.more').show(300);
			this.$('.actions>.moreactions').hide();
		},

		lessactions_clicked: function (event) {
			this.$('.actions>.more').hide(300);
			this.$('.actions>.moreactions').show();
		},

		killApp_clicked: function (event) {
			this.model.sendToPhone({
				killapp: true
			});
		},

		moreinfo_clicked: function (event) {
			this.$('.moreinfo').toggleClass('showEnterUsernameField')
		},

		usernameTextfield_clicked: function (event) {
			event.stopPropagation(); // else 'showEnterUsernameField' class gets toggled
		},

		usernameTextfield_keypressDetected: function (event) {
			if (event.keyCode == 13) {
	            // enter pressed

	            var username = this.$('.info>.moreinfo>.username>input').val();

	            this.model.sendToPhone({
					setUsernameTo: username
				});

				this.model.set('username', username);

				this.$('.moreinfo').removeClass('showEnterUsernameField')
	        }
		}

	});





	return {
		init: init
	};
};


