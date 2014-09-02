Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    items: [
        {xtype:'container',itemId:'selector_box',layout:{ type:'hbox'}},
        {xtype:'container',itemId:'display_box'},
        {xtype:'tsinfolink'}
    ],
    launch: function() {
        this._fetchModels().then({
            scope: this,
            success:function(models){
                this.models = models;
                this._addSelectors(this.down('#selector_box'));
                //this._addTree();
            },
            failure: function(error_msg){
                alert(error_msg);
            }
        });
    },
    _addSelectors: function(container){
        var model_names = Ext.Object.getKeys(this.models);
        var me = this;
        
        var field_picker = container.add({
            xtype:'rallyfieldpicker',
            autoExpand:true,
            margin: 10,
            alwaysExpanded: false,
            fieldLabel: 'Show Fields:',
            labelWidth: 75,
            modelTypes:model_names,
            useColumnHeaderLabels: true,
            stateful: true,
            stateId: 'rally.techservices.fields',
            stateEvents:['blur','select'],
            getState: function() {
                var value_array = [];
                Ext.Array.each(this.getValue(), function(value){
                    value_array.push(value.get('name'));
                });
                
                return this.addPropertyToState({},'value',value_array);
            },
            listeners: {
                scope: this,
                blur: function(picker){
                    console.log('blur');
                    var additional_columns = picker.getValue() || [];
                    this.logger.log("Changing picker from ", this.additional_columns, " to ", additional_columns);
                    if ( this._fieldArraysAreDifferent(this.additional_columns,additional_columns) ) {
                        this.additional_columns = additional_columns;
                        picker.collapse();
                        this._addTree();
                    }
                },
                change: function(picker) {
                    this.additional_columns = picker.getValue() || [];
                    picker.collapse();
                    if ( this.additional_columns.length > 0 ) {
                        this._addTree();
                    }
                }
            }
        });
        field_picker.on('expand',function(picker){picker.collapse();},this,{single:true});
        
        var release_box = container.add({
            xtype:'rallyreleasecombobox',
            fieldLabel: 'Release:',
            labelWidth: 50,
            margin: 10,
            stateful: true,
            stateId: 'rally.techservices.target.release',
            stateEvents:['blur'],
            listeners: {
                scope: this,
                change: function(rb){
                    if ( this.target_filter != rb.getQueryFromSelected() ) {
                        this.target_filter = rb.getQueryFromSelected();
                        this._addTree();
                    }
                }
            }
        });

    },
    _addTree: function() {
        var container = this.down('#display_box');

        container.removeAll();
        
        container.add({
            xtype:'insideouttree',
            columns: this._getColumns(),
            targetType: "UserStory",
            targetQuery: this.target_filter,
            margin: 10,
            listeners: {
                scope:this,
                afterrender:function(){
                    this.setLoading("Loading tree...");
                },
                afterloadtargets:function() {
                    this.setLoading('Finding relatives...');
                },
                afterload:function(){
                    this.setLoading('Building tree...');
                },
                aftertree:function(){
                    this.setLoading(false);
                }
            }
        });
    },
    _getColumns: function() {
        var me = this;
        var name_renderer = function(value,meta_data,record) {
            return me._nameRenderer(value,meta_data,record);
        };
        
        var magic_renderer = function(field,value,meta_data,record){
            return me._magicRenderer(field,value,meta_data,record);
        }
        
        var columns = [
            {
                xtype: 'treecolumn',
                text: 'Item',
                dataIndex: 'Name',
                itemId: 'tree_column',
                renderer: name_renderer,
                width: 400,
                menuDisabled: true,
                otherFields: ['FormattedID','ObjectID']
            }
        ];
        
        if ( this.additional_columns ) {
            this.logger.log("Additional fields: ", this.additional_columns);
            Ext.Array.each(this.additional_columns, function(field) {
                columns.push({
                    text:field.get('displayName').replace(/\(.*\)/,""),
                    dataIndex:field.get('name'),
                    menuDisabled: true,
                    renderer:function(value,meta_data,record){
                        return me._magicRenderer(field,value,meta_data,record) || "";
                    }
                });
            });
        }
        return columns;
    },
    _magicRenderer: function(field,value,meta_data,record){
        var field_name = field.get('name');
        var record_type = record.get('_type');
        var model = this.models[record_type];
        // will fail fi field is not on the record
        // (e.g., we pick accepted date, by are also showing features
        try {
            var template = Rally.ui.renderer.RendererFactory.getRenderTemplate(model.getField(field_name)) || "";
            return template.apply(record.data);
        } catch(e) {
            return ".";
        }
    },
    _nameRenderer: function(value,meta_data,record) {
        var display_value = record.get('Name');
        if ( record.get('FormattedID') ) {
            var link_text = record.get('FormattedID') + ": " + value;
            var url = Rally.nav.Manager.getDetailUrl( record );
            display_value = "<a target='_blank' href='" + url + "'>" + link_text + "</a>";
        }
        return display_value;
    },
    _fetchModels: function(){
        var deferred = Ext.create('Deft.Deferred');
        this._fetchPortfolioNames().then({
            scope: this,
            success:function(pi_names){
                var model_names = Ext.Array.merge(['defect','hierarchicalrequirement','testcase'],pi_names);
                console.log("model_names",model_names);
                Rally.data.ModelFactory.getModels({
                    types: model_names,
                    success: function(model_hash) {
                        deferred.resolve(model_hash);
                    },
                    failure: deferred.reject
                });
            },
            failure:deferred.reject
        });
        return deferred.promise;
    },
    _fetchPortfolioNames: function(){
        var deferred = Ext.create('Deft.Deferred');
        
        Ext.create('Rally.data.wsapi.Store', {
            autoLoad: true,
            model: 'TypeDefinition',
            sorters: [{
              property: 'Ordinal',
              direction: 'ASC'
            }],
            filters: [{
              property: 'Parent.Name',
              operator: '=',
              value: 'Portfolio Item'
            }, {
              property: 'Creatable',
              operator: '=',
              value: true
            }],
            listeners:  {
                scope: this,
                load: function(store, records, success){
                    if (success) {
                        var pi_model_names = _.map(records, function (rec) { return Ext.util.Format.lowercase(rec.get('TypePath')); });
                        deferred.resolve(pi_model_names);
                    } else {
                        deferred.reject('Error loading portofolio item names.');
                    }
               }
           }
        });
        return deferred.promise;
    },
    _fieldArraysAreDifferent:function(fields_1,fields_2) {
        var changed = false;
        Ext.Array.each(fields_1, function(field_1){
            var in_fields_2 = false;
            Ext.Array.each(fields_2,function(field_2){
                if ( field_2.get('name') == field_1.get('name') ) {
                    in_fields_2 = true;
                }
            });
            if ( ! in_fields_2 ) { changed=true; }
        });
        
        Ext.Array.each(fields_2, function(field_2){
            var in_fields_1 = false;
            Ext.Array.each(fields_1,function(field_1){
                if ( field_1.get('name') == field_2.get('name')) {
                    in_fields_1 = true;
                }
            });
            if ( ! in_fields_1 ) { changed=true; }
        });
        
        return changed;
    }
});