/*
 * bae-browser
 * https://github.com/Wirecloud/bae-browser-widget
 *
 * Copyright (c) 2016 CoNWeT Lab., Universidad Politécnica de Madrid
 * Licensed under the Apache-2.0 license.
 */

 /*global StyledElements, MashupPlatform, angular, Promise */

angular
    .module('widget', ['ngMaterial', 'ngResource', "angularMoment"])
    .controller('WidgetCtrl', function ($scope, $resource) {
        "use strict";

        var filtersWidget, detailsWidgets = {};
        var query, filters, harvestedOfferings;

        var baseUrl;

        var init = function init () {
            query = "";
            filters = {};
            baseUrl = MashupPlatform.prefs.get('server_url');
            harvestedOfferings = [];

            $scope.results = [];
            $scope.getDefaultImage = getDefaultImage;
            $scope.onDetailsClickListener = onDetailsClickListener;

            // Create the filters button and bind it
            var filtersButton = new StyledElements.Button({
                class: "btn-info",
                text: "Filters",
                title: "Select filters"
            });
            filtersButton.insertInto(document.getElementById("buttons"));
            filtersButton.addEventListener("click", createFiltersWidget);

            // Create the text filter and bind it
            var textFilter = new StyledElements.TextField({
                placeholder: "Keywords..."
            });
            textFilter.insertInto(document.getElementById("textFilter"));
            textFilter.addEventListener("submit", setQuery);
            textFilter.addEventListener("change", setQuery);

            // Create refresh button and bind it
            var refreshButton = new StyledElements.Button({
                class: "btn-info fa fa-refresh",
                text: "",
                title: "Fetch new data"
            });
            refreshButton.insertInto(document.getElementById("buttons"));
            refreshButton.addEventListener("click", function () {
                // Fetch new data
                search();
            });

            // Remove the filters widget as its data could be outdated
            MashupPlatform.prefs.registerCallback(function () {
                if (filtersWidget) {
                    filtersWidget.remove();
                    filtersWidget = null;
                }
                var keys = Object.keys(detailsWidgets);
                keys.forEach(function (key) {
                    detailsWidgets[key].remove();
                    detailsWidgets[key] = null;
                });

                detailsWidgets = {};

                baseUrl = MashupPlatform.prefs.get('server_url');
                // Fetch new data
                search();
            });

            search();
        };

        var setQuery = function setQuery (q) {
            q = q.getValue();
            query = "";

            if (typeof q === 'string' && q.length)  {
                query = q;
            }
            $scope.results = filterOfferings (harvestedOfferings, filters, query);
            $scope.$apply();
        };

        // Set the current chosen filters when the filterWidget sends its output
        var setFilters = function setFilters (fil) {
            filters = fil || {};

            if (typeof fil === 'string' && fil.length) {
                try {
                    filters = JSON.parse(fil);
                } catch (e) {
                }
            }

            $scope.results = filterOfferings (harvestedOfferings, filters, query);
            $scope.$apply();
        };

        // Create filter widget and connect it
        var createFiltersWidget = function createFiltersWidget () {
            if (filtersWidget != null) {
                return;
            }

            var filtersInput = MashupPlatform.widget.createInputEndpoint(setFilters);
            var options = {
                title: name + "Select desired filters",
                width: "400px",
                height: "300px",
                preferences: {
                    server_url: {
                        "value": MashupPlatform.prefs.get('server_url')
                    }
                }
            };

            filtersWidget = MashupPlatform.mashup.addWidget('CoNWeT/bae-search-filters/0.1.0', options);
            filtersInput.connect(filtersWidget.outputs.filters);
            //Bind remove event
            filtersWidget.addEventListener("remove", function () {
                filtersWidget = null;
            });

            return filtersInput;
        };

        // Creates a details widget and returns an output endpoint connected to it.
        var createDetailsWidget = function createDetailsWidget (name, id) {

            if (detailsWidgets[id]) {
                return;
            }

            var detailsOutput = MashupPlatform.widget.createOutputEndpoint();
            var options = {
                title: name + " Details",
                width: "400px",
                height: "300px"
            };

            var detailsWidget = MashupPlatform.mashup.addWidget('CoNWeT/bae-details/0.1.0', options);
            detailsWidget.inputs.offering.connect(detailsOutput);
            //Bind remove event
            detailsWidget.addEventListener("remove", function () {
                detailsWidget = null;
                delete detailsWidgets[id];
            });

            detailsWidgets[id] = detailsWidget;

            return detailsOutput;
        };

        // Creates details widget and sends chosen offering details to it.
        var onDetailsClickListener = function onDetailsClickListener (index) {
            var offering = $scope.results[index];
            var connectedOutput = createDetailsWidget(offering.name, offering.id);
            connectedOutput.pushEvent($scope.results[index]);
        };

        // Fetch data from the chosen server
        var search = function search() {
            harvestedOfferings = [];
            var url1 = baseUrl + '/DSProductCatalog/api/catalogManagement/v2/productOffering';

            $resource(url1).query({
                lifecycleStatus: 'Launched'
            }, function (offerings) {
                var url2 = baseUrl + '/DSProductCatalog/api/catalogManagement/v2/productSpecification';

                var idsToHarvest = [];
                offerings.forEach(function (offering) {
                    if (!offering.isBundle) { //Offering bundles dont have productSpecification
                        idsToHarvest.push(offering.productSpecification.id);
                    }
                });

                $resource(url2).query({
                    id: idsToHarvest.join()
                }, function (productspecs) {
                    var productspecs_by_id = {};

                    productspecs.forEach(function (data) {
                        productspecs_by_id[data.id] = data;
                    });

                    // Look for missing ids. (Due to a productSpec having a bundle of productSpecs)
                    var missingIds = [];
                    productspecs.forEach(function (data) {
                        if (data.isBundle) {
                            data.bundledProductSpecification.forEach(function (spec) {
                                if (productspecs_by_id[spec.id] === undefined) {
                                    missingIds.push(spec.id);
                                }
                            });
                        }
                    });

                    // Harvest missing product specs
                    $resource(url2).query({
                        id: missingIds.join()

                    }, function (bundledspecs) {
                        // Store harvested specs
                        bundledspecs.forEach(function (data) {
                            productspecs_by_id[data.id] = data;
                        });

                        // Bind the specs to the offerings
                        harvestedOfferings = offerings.map(function (data) {
                            if (!data.isBundle) {
                                data.productSpecification = productspecs_by_id[data.productSpecification.id];

                                // If an spec is a bundle, bind the bundled specs to it.
                                if (data.productSpecification.isBundle) {
                                    var specs =  [];
                                    // Append available specs
                                    data.productSpecification.bundledProductSpecification.forEach(function (spec) {
                                        specs.push(productspecs_by_id[spec.id]);
                                    });
                                    data.productSpecification.bundledProductSpecification = specs;
                                }
                            }

                            return data;
                        });

                        // Build offering bundles
                        harvestedOfferings.forEach(function (offering) {
                            if (offering.isBundle) {
                                offering.productSpecification = {
                                    isBundle: true,
                                    attachment: [{
                                        type: "Picture",
                                        url: ""
                                    }],
                                    bundledProductSpecification: []
                                };

                                var ids = [];
                                var isPictureSet = false;
                                offering.bundledProductOffering.forEach(function (data) {
                                    ids.push(data.id);
                                });

                                var currentSpecsIds = [];
                                harvestedOfferings.forEach(function (offer) {
                                    var i = ids.indexOf(offer.id);
                                    if (i !== -1) {
                                        ids.splice(i, 1);
                                        if (!offer.productSpecification.isBundle) {
                                            // don't allow repeated specs
                                            if (currentSpecsIds.indexOf(offer.productSpecification.id) === -1) {
                                                offering.productSpecification.bundledProductSpecification.push(offer.productSpecification);
                                                currentSpecsIds.push(offer.productSpecification.id);

                                                // Try to set the offering image.
                                                if (!isPictureSet) {
                                                    isPictureSet = setBundledOfferingImage(offering, offer.productSpecification);
                                                }
                                            }

                                        } else {
                                            offer.productSpecification.bundledProductSpecification.forEach(function (spec) {
                                                // don't allow repeated specs
                                                if (currentSpecsIds.indexOf(spec.id) === -1) {
                                                    offering.productSpecification.bundledProductSpecification.push(spec);
                                                    currentSpecsIds.push(spec.id);

                                                    // Try to set the offering image
                                                    if (!isPictureSet) {
                                                        isPictureSet = setBundledOfferingImage(offering, spec);
                                                    }
                                                }
                                            });
                                        }
                                    }
                                });
                            }
                        });

                        // Harvest asset Data
                        var promises = [];
                        Object.keys(productspecs_by_id).forEach(function (key) {
                            var asset = productspecs_by_id[key];
                            var characteristics = asset.productSpecCharacteristic;
                            // Only harvest asset data if its a Wirecloud Component
                            if (characteristics) {
                                if (characteristics.some(function (char) {
                                    if (char.name === "Asset type") {
                                        return "Wirecloud component" === char.productSpecCharacteristicValue[0].value;
                                    }
                                })) {
                                    promises.push(harvestAssetData(asset));
                                }
                            }
                        });

                        // Wait for asset data
                        Promise.all(promises).then(function () {
                            // Filter the offerings
                            $scope.results = filterOfferings (harvestedOfferings, filters, query);
                            $scope.$apply();
                        });
                    });
                });
            });
        };

        // Returns a promise harvesting the asset data of a productSpecification
        var harvestAssetData = function harvestAssetData (spec) {
            return new Promise (function (fulfill, reject) {
                var url = baseUrl + "/charging/api/assetManagement/assets/product/" + spec.id;
                $resource(url).query({},
                    function (asset) {
                        spec.asset = asset[0];
                        fulfill(true);
                    }
                );
            });
        };

        var setBundledOfferingImage = function setBundledOfferingImage (offering, spec) {
            var img = getDefaultImage(spec);
            if (img && img !== "") {
                offering.productSpecification.attachment[0].url = img;
                return true;
            } else {
                return false;
            }
        };

        // Apply filters to harvested data
        var filterOfferings = function filterOfferings (data, filters, query) {
            // If there are no filters to apply return data
            if (Object.keys(filters).length === 0 && query === "") {
                return data;
            }
            var regex = new RegExp(query, "i");

            var results = [];
            data.forEach(function (offering) {
                if (filters.offeringType != null) {
                    if ((filters.offeringType === "bundle") !== (offering.isBundle || offering.productSpecification.isBundle)) {
                        return;
                    }
                }

                if (filters.macType) {
                    var mediaType = "";
                    // Loop all producSpecs of the offering
                    var specs = offering.productSpecification.bundledProductSpecification || [offering.productSpecification];

                    if (!specs.some(function (spec) {
                        var characteristics = spec.productSpecCharacteristic;
                        if (characteristics) {
                            for (var i = 0; i < characteristics.length; i++) {
                                if (characteristics[i].name === "Media type") {
                                    mediaType = characteristics[i].productSpecCharacteristicValue[0].value;
                                }
                            }
                        }

                        return filters.macType === mediaType;
                    })) {
                        return;
                    }
                }

                if (filters.catalogueId) {
                    if (offering.href.match(/catalog\/(.*)\/productOffering/)[1] !== filters.catalogueId) {
                        return;
                    }
                }
                if (filters.categoryId) {
                    if (!offering.category.some(function (cat) {
                        return filters.categoryId === cat.id;
                    })) {
                        return;
                    }
                }

                // Apply the query filter
                if (!regex.test(offering.name)) {
                    return;
                }

                results.push(offering);
            });

            return results;
        };

        // Return the first attached image
        var getDefaultImage = function getDefaultImage (spec) {
            var attachments = spec.attachment;
            for (var i = 0; i < attachments.length; i++) {
                if (attachments[i].type === "Picture") {
                    return attachments[i].url;
                }
            }
            return "";
        };

        init();
    });