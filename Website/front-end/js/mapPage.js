/**
 * File Name: mapPage.js
 * Author: Vineeth Kirandumkara
 * Date: 06/01/25
 * Description: Javascript file for the MapPage
 */

var map;
var mapWindow;

document.addEventListener('DOMContentLoaded', async () => {
    const response = await fetch('http://localhost:3000/api/key');
    const data = await response.json();
    const apiKey = data.apiKey;
  
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap`;
    script.async = true;
    document.body.appendChild(script);
});

function initMap(){
    mapWindow = new google.maps.InfoWindow({maxWidth: 300});

    var mapOptions = {
        center: new google.maps.LatLng(51.514756, -0.104345),
        zoom: 14,
        styles: themedMap
    };

    map = new google.maps.Map(document.getElementById("mapCanvas"), mapOptions);

    google.maps.event.addListener(map, 'dragend', function() {
        var bounds = map.getBounds();
        console.log("SW: " + bounds.getSouthWest() + " NE: " + bounds.getNorthEast());
        console.log("Center: " + map.getCenter().lat() + ", " +  map.getCenter().lng());
        getData(map.getCenter().lat(), map.getCenter().lng());
    });
}