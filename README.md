google-map-storyboard
=====================
##Summary##
The 'google-map-storyboard' Polymer component creates a  [google-map](https://github.com/GoogleWebComponents/google-map) with 'scenes'  associated with locations on the map.

####Attributes####
**apiKey**
  Your Google Maps API Key.
  *default: null*

**showTransitionLine**
  Whether or not a line should be shown on the transitions between the scenes.
  *default: true*

#google-map-scene#
The 'google-map-scene' highlights a location and also shows pictures from that location.

####Attributes####
**address**
  The address/location of the scene.
  *default: null*

**zoom**
  The zoom at which to show this scene.
  *default: 10*
  
**isImage**
  Is the content an image.
  *default: false*
