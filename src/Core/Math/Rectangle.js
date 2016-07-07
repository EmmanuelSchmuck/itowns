/**
 * Generated On: 2015-10-5
 * Class: Rectangle
 */

define('Core/Math/Rectangle', ['Core/defaultValue', 'THREE'],
      function(defaultValue, THREE) {

          function Rectangle(options) {
              this._west  = defaultValue(options.west, 0);
              this._south = defaultValue(options.south, 0);
              this._east  = defaultValue(options.east, 0);
              this._north = defaultValue(options.north, 0);
          }

        Rectangle.prototype.getWest = function(){
            return this._west;
        };

        Rectangle.prototype.getSouth = function(){
           return this._south;
        };

        Rectangle.prototype.getEast = function(){
           return this._east;
        };

        Rectangle.prototype.getNorth = function(){
           return this._north;
        };

        //if Right2 < Right1 && Left2 > Left1 && Top2 < Top1 && Bottom2 > Bottom1
        //this is correct only for coordinate positive
        Rectangle.prototype.contains = function(rect){
                var vmin = new THREE.Vector2(rect.getWest(), rect.getSouth());
                var vmax = new THREE.Vector2(rect.getEast(), rect.getNorth());
                return this.containsPoint(vmin) && this.containsPoint(vmax);
        };

        Rectangle.prototype.containsPoint = function( v) {
            if (!v) {
                throw new Error('point is required.');
            }

            var longitude = v.x;
            var latitude  = v.y;

            var west = this._west;
            var east = this._east;

            return (longitude > west ) &&
               (longitude < east ) &&
               latitude >= this._south &&
               latitude <= this._north;
    };


    return Rectangle;

});
